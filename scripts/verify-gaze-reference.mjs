import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { sampleEyeGazeMatrix } from '../src/eye-gaze.js';
const data = JSON.parse(await fs.readFile('public/orbit/gaze/profiles.json', 'utf8'));
const holdouts = JSON.parse(await fs.readFile('output/gaze-reference/holdout.json', 'utf8'));
try { holdouts.push(...JSON.parse(await fs.readFile('output/gaze-reference/dense-holdouts.json', 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const result = [];
const target = new Vector3(), actual = new Vector3(), predicted = new Vector3();
for (const config of holdouts.filter(c => !c.missing)) {
  const profile = data.profiles[data.aliases[config.key] ?? config.key];
  const assembly = JSON.parse(await fs.readFile(`public/orbit/assemblies/${config.key}.json`, 'utf8'));
  const bytes = await fs.readFile(`public/orbit/assemblies/${config.key.split('/')[0]}/${assembly.dataFile}`);
  const binary = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const sample of config.samples) {
    let maxError = 0, maxPart = '', vertexCount = 0, sumSquared = 0;
    const bodyInverse = new Matrix4().fromArray(sample.draws[0].world).invert();
    assembly.records.forEach((record, index) => {
      if (!profile.records[record.key]) return;
      const native = new Matrix4().multiplyMatrices(bodyInverse, new Matrix4().fromArray(sample.draws[index].world));
      const estimated = sampleEyeGazeMatrix(profile.records[record.key], profile.grid ?? data.grid, sample.x, sample.y, undefined, profile.interpolation, record.nativeAnchor);
      for (let vertex = 0; vertex < record.vertexCount; vertex++) {
        const offset = record.binary.positionOffset + vertex * 12;
        target.set(binary.getFloat32(offset, true), binary.getFloat32(offset + 4, true), binary.getFloat32(offset + 8, true));
        actual.copy(target).applyMatrix4(native);
        predicted.copy(target).applyMatrix4(estimated);
        const error = actual.distanceTo(predicted);
        if (error > maxError) { maxError = error; maxPart = record.key; }
        sumSquared += error ** 2;
        vertexCount++;
      }
    });
    const grid = profile.grid ?? data.grid;
    result.push({ key: config.key, x: sample.x, y: sample.y, independent: !(grid.includes(sample.x) && grid.includes(sample.y)), maxError, rmsError: Math.sqrt(sumSquared / vertexCount), vertexCount, maxPart });
  }
}
await fs.writeFile('output/gaze-reference/holdout-errors.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.map(({ maxPart, ...r }) => r), null, 2));
console.log('Maximum model-space vertex error:', Math.max(...result.map(r => r.maxError)));
const independent = result.filter(r => r.independent);
assert(independent.length >= 20, 'Too few independent reference poses');
assert(Math.max(...independent.map(r => r.maxError)) < .002, 'Native reference interpolation exceeds the model-space tolerance');
