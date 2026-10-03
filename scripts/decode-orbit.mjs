import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const source = path.resolve('output/original-dots');
const destination = path.resolve('public/orbit/decoded');
const catalog = JSON.parse(await fs.readFile(path.join(source, 'catalog.json'), 'utf8'));
await fs.mkdir(destination, { recursive: true });

function unpack(input) {
  if (input.subarray(0, 8).toString() !== 'ORBZLIB1') return input;
  const result = inflateSync(input.subarray(16));
  if (Number(input.readBigUInt64LE(8)) !== result.length) throw new Error('Inflated length mismatch');
  return result;
}

// Float bit patterns are delta/zigzag coded, then split into four byte planes.
function floatComponent(bytes, start, count) {
  const bits = new Uint32Array(count);
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    const value = (bytes[start + i] | bytes[start + count + i] << 8 | bytes[start + count * 2 + i] << 16 | bytes[start + count * 3 + i] << 24) >>> 0;
    previous = (previous + ((value >>> 1) ^ -(value & 1))) >>> 0;
    bits[i] = previous;
  }
  return new Float32Array(bits.buffer);
}

function indices(bytes, count, width, start, mask) {
  const output = new Uint32Array(count);
  const lanes = [];
  let cursor = start;
  for (let lane = 0; lane < width; lane += 1) {
    const fixed = Boolean(mask & (1n << BigInt(lane)));
    lanes.push(fixed ? new Uint8Array(count).fill(bytes[cursor]) : bytes.subarray(cursor, cursor + count));
    cursor += fixed ? 1 : count;
  }
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    let value = 0;
    for (let lane = 0; lane < width; lane += 1) value |= lanes[lane][i] << (lane * 8);
    previous += (value >>> 1) ^ -(value & 1);
    output[i] = previous;
  }
  if (cursor !== bytes.length) throw new Error(`Unconsumed mesh bytes: ${bytes.length - cursor}`);
  return output;
}

function attributes(bytes, vertexCount) {
  const mask = bytes.readBigUInt64LE(20);
  const components = [];
  let cursor = 28;
  for (let component = 0; component < 8; component += 1) {
    const planes = Buffer.alloc(vertexCount * 4);
    for (let lane = 0; lane < 4; lane += 1) {
      const fixed = Boolean(mask & (1n << BigInt(component * 4 + lane)));
      if (fixed) planes.fill(bytes[cursor], lane * vertexCount, (lane + 1) * vertexCount);
      else bytes.copy(planes, lane * vertexCount, cursor, cursor + vertexCount);
      cursor += fixed ? 1 : vertexCount;
    }
    components.push(floatComponent(planes, 0, vertexCount));
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      position[i * 3 + axis] = components[axis][i];
      normal[i * 3 + axis] = components[axis + 3][i];
    }
  }
  return { position, normal, indexMask: bytes.readBigUInt64LE(cursor), indexStart: cursor + 8 };
}

function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 1) {
    if (!Number.isFinite(positions[i])) throw new Error('Nonfinite coordinate');
    const axis = i % 3;
    min[axis] = Math.min(min[axis], positions[i]);
    max[axis] = Math.max(max[axis], positions[i]);
  }
  return { min, max, size: min.map((v, axis) => max[axis] - v), center: min.map((v, axis) => (max[axis] + v) / 2) };
}

const manifest = {
  schemaVersion: 1,
  source: 'User-selected chatgpt.com/dots page, official runtime virtual filesystem',
  sourceRevision: JSON.parse(await fs.readFile(path.join(source, 'native-resources.json'), 'utf8')).geometryRevision,
  units: 'Original authored normalized units; longest 2D body dimension is approximately 2. Original depth is approximately 0.8.',
  coordinateSystem: 'x right, y up, z front',
  encoding: 'Binary files contain interleaved float32 xyz positions, interleaved float32 xyz normals, then uint32 triangle indices, little endian.',
  unresolved: ['Original procedural authoring equations are not exposed by the downloaded resource manifest.', 'The final two ORBITM04 vertex fields are retained in source meshes; their semantics are not assigned guessed names.', 'ORBFACE3 hash keys need to be matched with native runtime assembly output before named fitting parameters can be reported.'],
  shapes: {},
  meshes: {},
};

const shapeIds = new Set(catalog[0].map((entry) => entry.id));
const meshFiles = (await fs.readdir(path.join(source, 'meshes/balanced'))).filter((name) => name.endsWith('.orbitmesh')).sort();
for (const filename of meshFiles) {
  const id = filename.replace(/\.orbitmesh$/, '');
  const entry = catalog[0].find((item) => item.id === id) ?? { id, title: id };
  const original = await fs.readFile(path.join(source, 'meshes/balanced', `${entry.id}.orbitmesh`));
  const bytes = unpack(original);
  if (bytes.subarray(0, 8).toString() !== 'ORBITM04') throw new Error(`Unsupported mesh: ${entry.id}`);
  const vertexCount = bytes.readUInt32LE(8);
  const indexCount = bytes.readUInt32LE(12);
  const indexWidth = bytes.readUInt32LE(16);
  const { position, normal, indexStart, indexMask } = attributes(bytes, vertexCount);
  const index = indices(bytes, indexCount, indexWidth, indexStart, indexMask);
  const box = bounds(position);
  let minimumNormalLength = Infinity;
  let maximumNormalLength = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const length = Math.hypot(...normal.subarray(i * 3, i * 3 + 3));
    minimumNormalLength = Math.min(length, minimumNormalLength);
    maximumNormalLength = Math.max(length, maximumNormalLength);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 0.001) throw new Error(`Invalid normal: ${entry.id}:${i}`);
  }
  for (const value of index) if (value >= vertexCount) throw new Error(`Invalid index: ${entry.id}`);
  let surfaceArea = 0;
  let signedVolume = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = position.subarray(index[i] * 3, index[i] * 3 + 3);
    const b = position.subarray(index[i + 1] * 3, index[i + 1] * 3 + 3);
    const c = position.subarray(index[i + 2] * 3, index[i + 2] * 3 + 3);
    const u = b.map((v, axis) => v - a[axis]);
    const v = c.map((x, axis) => x - a[axis]);
    surfaceArea += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  if (surfaceArea <= 0 || signedVolume <= 0) throw new Error(`Invalid surface topology: ${entry.id}`);
  const binary = Buffer.concat([Buffer.from(position.buffer), Buffer.from(normal.buffer), Buffer.from(index.buffer)]);
  await fs.writeFile(path.join(destination, `${entry.id}.bin`), binary);
  const metrics = {
    id: entry.id, title: entry.title, file: `${entry.id}.bin`, vertexCount, indexCount, triangleCount: indexCount / 3,
    bounds: box, surfaceArea, signedVolume, minimumNormalLength, maximumNormalLength,
    sourceSha256: createHash('sha256').update(original).digest('hex'),
    decodedSha256: createHash('sha256').update(binary).digest('hex'),
  };
  manifest.meshes[entry.id] = metrics;
  if (shapeIds.has(entry.id)) manifest.shapes[entry.id] = metrics;
}

// Keep the hash-keyed fitting records available without inventing field semantics.
const fitted = {};
for (const entry of catalog[0]) {
  const bytes = await fs.readFile(path.join(source, 'fitted/balanced', `${entry.id}.orbitfaces`));
  if (bytes.subarray(0, 8).toString() !== 'ORBFACE3') throw new Error('Unsupported fitting cache');
  const count = bytes.readUInt32LE(80);
  let cursor = 84;
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const hash = bytes.subarray(cursor, cursor + 64).toString();
    const size = bytes.readUInt32LE(cursor + 64);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid fit record hash');
    records.push({ hash, offset: cursor + 68, byteLength: size, rawBase64: bytes.subarray(cursor + 68, cursor + 68 + size).toString('base64') });
    cursor += 68 + size;
  }
  if (cursor !== bytes.length) throw new Error('Unparsed fit cache data');
  fitted[entry.id] = { revision: bytes.readUInt32LE(8), cacheKey: bytes.subarray(16, 80).toString(), records };
}
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(destination, 'fitted-records.json'), JSON.stringify({ schemaVersion: 1, fieldSemantics: 'unresolved; original records preserved verbatim', shapes: fitted }));
console.log(`Decoded and verified ${Object.keys(manifest.meshes).length} meshes (${Object.keys(manifest.shapes).length} bodies) and ${Object.values(fitted).reduce((n, x) => n + x.records.length, 0)} fitting records.`);
