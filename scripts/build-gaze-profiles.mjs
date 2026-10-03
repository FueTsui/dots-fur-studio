// Convert native WebGL DrawBlock captures into body-local transforms.
// Capture order is verified by UBO offset AND the original indexed draw count.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await fs.readFile(new URL(path, root), 'utf8'));
const manifest = await read('output/gaze-reference/configurations.json');
const captures = await read('output/gaze-reference/native-profiles.json');
const output = {
  schemaVersion: 1,
  source: 'https://chatgpt.com/dots/',
  renderer: 'orbit-character-a46c99f7e8749621/fec1363c5aea4fbb',
  method: 'Native DrawBlock eye matrix relative to body, per component. 3x3 samples for surface eyes, denser per-profile grids for inset eyes. Intermediate poses are interpolated, not the original continuous solver.',
  grid: [-1, 0, 1],
  coordinateSystem: 'look x right, y up; matrices column-major; samples row-major y then x',
  aliases: Object.fromEntries(manifest.configurations.map(c => [c.key, c.profileKey])),
  profiles: {},
};
let sampleCount = 0, recordCount = 0, hiddenSamples = 0;
for (const config of manifest.profiles) {
  const capture = captures.find(p => p.key === config.key);
  assert(capture, `Missing capture ${config.key}`);
  const assembly = await read(`public/orbit/assemblies/${config.key}.json`);
  assert.deepEqual(capture.counts, assembly.records.map(r => r.indexCount), `Draw order/count mismatch ${config.key}`);
  const grid = capture.grid ?? output.grid;
  assert.equal(capture.samples.length, grid.length ** 2);
  const profile = { grid, interpolation: config.eyes.includes('inset') ? 'affine-rotation' : 'biquadratic', pivots: {}, records: {} };
  assembly.records.forEach(record => {
    if (record.name === config.eyes) {
      profile.records[record.key] = [];
      profile.pivots[record.key] = record.nativeAnchor;
    }
  });
  for (let s = 0; s < capture.samples.length; s++) {
    const sample = capture.samples[s];
    assert.equal(sample.x, grid[s % grid.length]);
    assert.equal(sample.y, grid[Math.floor(s / grid.length)]);
    assert.equal(sample.draws.length, assembly.records.length);
    const bodyInverse = new Matrix4().fromArray(sample.draws[0].world).invert();
    assert(Math.abs(bodyInverse.determinant()) > .5, 'Invalid body transform');
    for (let index = 0; index < assembly.records.length; index++) {
      const record = assembly.records[index], draw = sample.draws[index];
      assert.equal(draw.offset, index * 512, 'Invalid UBO offset');
      if (record.name !== config.eyes) continue;
      assert(Math.abs(draw.parameters[2]) + Math.abs(draw.parameters[3]) < .000001, `Blink-contaminated sample ${config.key} ${sample.x},${sample.y}`);
      const relative = new Matrix4().multiplyMatrices(bodyInverse, new Matrix4().fromArray(draw.world));
      assert(relative.elements.every(Number.isFinite), 'Nonfinite eye transform');
      if (Math.abs(relative.determinant()) < 1e-8) hiddenSamples++;
      // Keep native center transforms, including stowed eyelids. They can be singular.
      profile.records[record.key].push(relative.toArray().map(v => Number(v.toFixed(9))));
      sampleCount++;
    }
  }
  recordCount += Object.keys(profile.records).length;
  output.profiles[config.key] = profile;
}
await fs.mkdir(new URL('public/orbit/gaze/', root), { recursive: true });
await fs.writeFile(new URL('public/orbit/gaze/profiles.json', root), JSON.stringify(output));
const summary = { configurations: manifest.configurations.length, profiles: captures.length, records: recordCount, samples: sampleCount, hiddenSamples };
await fs.writeFile(new URL('output/gaze-reference/profile-build.json', root), JSON.stringify(summary, null, 2));
console.log(summary);
