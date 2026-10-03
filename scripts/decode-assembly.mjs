import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('./assembly-extract-browser.js', import.meta.url), 'utf8');
const context = vm.createContext({ Uint8Array, DataView, Array, String, Number, Math, Infinity, Error });
vm.runInContext(`${source}\nthis.extract = extractOrbitAssembly;`, context);
export const extractOrbitAssembly = context.extract;

/** Lossless float32 packing of the already extracted native data. */
export async function packAssemblies(directory) {
  const root = resolve(directory);
  const statistics = { files: 0, records: 0, originalBytes: 0, packedBytes: 0, skipped: 0 };
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.name.endsWith('.json')) continue;
      const original = await readFile(file);
      const data = JSON.parse(original);
      if (data.schemaVersion !== 1 || !Array.isArray(data.records) || data.dataFile) { statistics.skipped += 1; continue; }
      const chunks = [];
      let offset = 0;
      for (const record of data.records) {
        if (!record.position) continue;
        if (record.position.length !== record.vertexCount * 3 || record.normal?.length !== record.vertexCount * 3 || record.index?.length !== record.indexCount) throw new Error(`Invalid vertex dimensions: ${file}`);
        if (!record.position.every(Number.isFinite) || !record.normal.every(Number.isFinite)) throw new Error(`Nonfinite vertices: ${file}`);
        if (!record.index.every((index) => Number.isInteger(index) && index >= 0 && index < record.vertexCount)) throw new Error(`Out-of-range triangle index: ${file}`);
        record.binary = { positionOffset: offset, normalOffset: offset + record.vertexCount * 12, indexOffset: offset + record.vertexCount * 24 };
        for (const field of ['position', 'normal', 'index']) {
          const values = field === 'index' ? new Uint32Array(record[field]) : new Float32Array(record[field]);
          const buffer = Buffer.from(values.buffer);
          chunks.push(buffer);
          offset += buffer.byteLength;
          delete record[field];
        }
        statistics.records += 1;
      }
      if (!chunks.length) { statistics.skipped += 1; continue; }
      const bytes = Buffer.concat(chunks);
      const dataFile = `${basename(file, '.json')}.bin`;
      data.dataFile = dataFile;
      data.binaryEncoding = 'little-endian float32 positions, float32 normals, uint32 indices; per-record byte offsets';
      data.binarySha256 = createHash('sha256').update(bytes).digest('hex');
      const packed = JSON.stringify(data);
      await writeFile(join(folder, dataFile), bytes);
      await writeFile(`${file}.packing`, packed);
      await rename(`${file}.packing`, file);
      statistics.files += 1;
      statistics.originalBytes += original.byteLength;
      statistics.packedBytes += bytes.byteLength + Buffer.byteLength(packed);
    }
  }
  await visit(root);
  return statistics;
}

if (process.argv[2] === '--pack') {
  console.log(JSON.stringify(await packAssemblies(process.argv[3] ?? 'public/orbit/assemblies')));
} else if (process.argv[2]) {
  const input = resolve(process.argv[2]);
  const output = resolve(process.argv[3] ?? input.replace(/\.bin$/, '.json'));
  const data = extractOrbitAssembly(await readFile(input), { includeBody: process.argv.includes('--body') });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(data));
  console.log(JSON.stringify({ input, output, records: data.records.map(({ name, isBody, vertexCount, indexCount, color, nativeAnchor, bounds }) => ({ name, isBody, vertexCount, indexCount, color, nativeAnchor, bounds })) }));
}
