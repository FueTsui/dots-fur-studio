import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CATALOG, DEFAULT_APPEARANCE } from '../src/catalog.js';
import { DEFAULTS, createBodyMaterial } from '../src/fur.js';
import { normalizeAppearance, normalizeAccessoryColors, loadSettings, saveSettings, STORAGE_KEY } from '../src/settings.js';
import { loadPreparedBody, loadOriginalAccessories, updateAccessoryColors, disposeOriginalAccessories } from '../src/original-accessories.js';

// Test persisted choices and the real native meshes without contacting the network.
const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://127.0.0.1');
  assert.equal(url.hostname, '127.0.0.1', 'Verification must not access the network');
  const file = path.resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
  assert(file.startsWith(`${publicRoot}${path.sep}`), 'Verification must stay inside public/');
  try { return new Response(await fs.readFile(file), { status: 200 }); }
  catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error; }
};

function colorOf(mesh) {
  return mesh.material.uniforms?.uColor?.value ?? mesh.material.color;
}

function colorNear(actual, expected, label) {
  const target = expected?.isColor ? expected : new THREE.Color(expected);
  for (const channel of ['r', 'g', 'b']) {
    assert(Math.abs(actual[channel] - target[channel]) < 1e-8, `${label}: ${channel} differs`);
  }
}

function geometryDigest(geometry) {
  const hash = createHash('sha256');
  for (const attribute of [geometry.attributes.position, geometry.attributes.normal, geometry.index]) {
    const array = attribute.array;
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
}

let checkedMeshes = 0;
let recolorChecks = 0;
let fabricChecks = 0;
const expectedFabricIds = new Set(['beanie', 'hat', 'beret', 'orb', 'three_lobe']);
const fabricCoverage = new Map();
try {
  const normalized = normalizeAppearance({
    ...DEFAULT_APPEARANCE,
    accessories: ['bow'],
    accessoryColors: { bow: '#AbC', crown: '#A1b2C3', hat: 'red', beanie: '#12345g', orb: '#12345678', not_an_accessory: '#abcdef' },
  });
  assert.deepEqual(normalized.accessoryColors, { bow: '#aabbcc', crown: '#a1b2c3' });
  assert.equal(normalized.color, DEFAULT_APPEARANCE.color, 'An accessory override must not change the body color');
  const inherited = Object.create({ bow: '#f00' });
  inherited.crown = '#0f0';
  assert.deepEqual(normalizeAccessoryColors(inherited), { crown: '#00ff00' }, 'Inherited color overrides must be ignored');
  const hostile = JSON.parse('{"__proto__":"#123456","constructor":"#123456","prototype":"#123456","bow":"#123456"}');
  assert.deepEqual(normalizeAccessoryColors(hostile), { bow: '#123456' }, 'Only real accessory IDs may survive');
  for (const invalid of [null, undefined, [], '#abc', 42, true]) assert.deepEqual(normalizeAccessoryColors(invalid), {});
  for (const invalid of ['red', 'rgb(1,2,3)', '#12', '#1234', '#12345', '#1234567', '#ggg', 0, null, {}]) {
    assert.deepEqual(normalizeAccessoryColors({ bow: invalid }), {}, `Invalid color must be dropped: ${String(invalid)}`);
  }

  const colors = Object.fromEntries(CATALOG.accessories.map(({ id }, i) => [id, `#${(0x123456 + i * 0x10101).toString(16)}`]));
  const noAccessory = normalizeAppearance({ ...DEFAULT_APPEARANCE, accessories: [], accessoryColors: colors });
  assert.deepEqual(noAccessory.accessoryColors, colors, 'Taking off an accessory must retain its color');
  const restricted = normalizeAppearance({ ...noAccessory, shape: 'rounded_head_two_ears', accessories: ['hat'] });
  assert.deepEqual(restricted.accessories, []);
  assert.deepEqual(restricted.accessoryColors, colors, 'Changing to an incompatible shape must retain unworn colors');
  for (const { id } of CATALOG.accessories) {
    const changed = normalizeAppearance({ ...noAccessory, accessories: [id], accessoryColors: { ...colors, [id]: '#fedcba' } });
    for (const other of CATALOG.accessories) assert.equal(changed.accessoryColors[other.id], other.id === id ? '#fedcba' : colors[other.id]);
  }

  saveSettings({ appearance: noAccessory, parameters: DEFAULTS, quality: 'high' });
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal(saved.version, 2, 'New colors must not discard existing v2 storage');
  assert.deepEqual(loadSettings(), { appearance: noAccessory, parameters: DEFAULTS, quality: 'high' });
  const legacyAppearance = { ...DEFAULT_APPEARANCE, accessories: ['bow'] };
  delete legacyAppearance.accessoryColors;
  storage.set(STORAGE_KEY, JSON.stringify({ version: 2, appearance: legacyAppearance, parameters: DEFAULTS, quality: 'medium' }));
  assert.deepEqual(loadSettings().appearance.accessoryColors, {}, 'Old saved appearances need native accessory colors');
  assert.deepEqual(loadSettings().appearance.accessories, ['bow'], 'Old saved accessories must remain selected');
  assert.equal(loadSettings().quality, 'medium');
  storage.set(STORAGE_KEY, JSON.stringify({ version: 2, appearance: { ...legacyAppearance, accessoryColors: hostile } }));
  assert.deepEqual(loadSettings().appearance.accessoryColors, { bow: '#123456' }, 'Persisted imported colors must also be normalized');

  for (const { id } of CATALOG.accessories) {
    const group = await loadOriginalAccessories({ ...DEFAULT_APPEARANCE, eyewear: 'monocle', accessories: [id], accessoryColors: colors });
    const bodyGeometry = await loadPreparedBody(DEFAULT_APPEARANCE.shape);
    const body = new THREE.Mesh(bodyGeometry, createBodyMaterial('#fa70ab', DEFAULTS));
    body.userData.original = bodyGeometry.userData.metrics;
    group.add(body);
    const meshes = [];
    group.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
    const accessories = meshes.filter(mesh => mesh.userData.original.category === 'accessories');
    const fixed = meshes.filter(mesh => mesh.userData.original.category !== 'accessories');
    assert(accessories.length > 0, `${id}: no native accessory meshes found`);
    const furMeshes = group.userData.furParts.map(part => part.mesh);
    if (expectedFabricIds.has(id)) {
      assert.deepEqual(new Set(furMeshes), new Set(accessories), `${id}: every accessory component must receive the short fur layer`);
    } else {
      assert.equal(furMeshes.length, 0, `${id}: hard accessories must not receive a fur layer`);
    }
    assert(fixed.some(mesh => mesh.userData.original.category === 'eyes'));
    assert(fixed.some(mesh => mesh.userData.original.category === 'eyewear'));
    assert(fixed.some(mesh => mesh.userData.original.category === 'shape'));
    const snapshot = meshes.map(mesh => ({
      mesh, geometry: mesh.geometry, digest: geometryDigest(mesh.geometry), material: mesh.material,
      metric: JSON.stringify(mesh.userData.original), nativeRgb: JSON.stringify(mesh.material.userData.nativeRgb),
      color: colorOf(mesh).clone(), matrix: mesh.matrix.clone(),
    }));
    const fixedColors = fixed.map(mesh => [mesh, colorOf(mesh).clone()]);
    const metricSnapshot = JSON.stringify(group.userData.metrics);
    for (const mesh of accessories) colorNear(colorOf(mesh), colors[id], `${id}: initial loaded override`);

    // Every swatch in the shared shape palette must work on every accessory.
    for (const { hex } of CATALOG.colors) {
      updateAccessoryColors(group, { ...colors, [id]: hex });
      for (const mesh of accessories) colorNear(colorOf(mesh), hex, `${id}: live swatch ${hex}`);
      for (const [mesh, color] of fixedColors) colorNear(colorOf(mesh), color, `${id}: unrelated mesh changed`);
      for (const part of group.userData.furParts) assert.equal(part.color, hex.toLowerCase(), `${id}: fur color is stale`);
      recolorChecks += 1;
    }
    updateAccessoryColors(group, {});
    for (const mesh of accessories) colorNear(colorOf(mesh), new THREE.Color().setRGB(...mesh.userData.original.color, THREE.SRGBColorSpace), `${id}: native color reset`);
    for (const before of snapshot) {
      assert.equal(before.mesh.geometry, before.geometry, `${id}: recolor rebuilt the geometry`);
      assert.equal(geometryDigest(before.mesh.geometry), before.digest, `${id}: recolor modified native vertices`);
      assert.equal(before.mesh.material, before.material, `${id}: recolor rebuilt the material`);
      assert.equal(JSON.stringify(before.mesh.userData.original), before.metric, `${id}: source provenance changed`);
      assert.equal(JSON.stringify(before.mesh.material.userData.nativeRgb), before.nativeRgb, `${id}: source RGB changed`);
      assert(before.mesh.matrix.equals(before.matrix), `${id}: recolor changed a transform`);
    }
    assert.equal(JSON.stringify(group.userData.metrics), metricSnapshot, 'Source metrics must retain native colors');

    // The application replaces fabric base materials with its body shader. The
    // original metric must remain sufficient to reset even without nativeRgb.
    for (const part of group.userData.furParts) {
      part.mesh.material.dispose();
      part.mesh.material = createBodyMaterial(part.color, DEFAULTS);
      assert.equal(part.mesh.material.userData.nativeRgb, undefined);
      const material = part.mesh.material;
      updateAccessoryColors(group, { [id]: '#fEd' });
      colorNear(colorOf(part.mesh), '#ffeedd', `${id}: fabric shader override`);
      assert.equal(part.color, '#ffeedd');
      updateAccessoryColors(group, { [id]: 'invalid' });
      const native = new THREE.Color().setRGB(...part.mesh.userData.original.color, THREE.SRGBColorSpace);
      colorNear(colorOf(part.mesh), native, `${id}: fabric shader reset`);
      assert.equal(part.color, `#${native.getHexString()}`);
      assert.equal(part.mesh.material, material, `${id}: fabric recolor rebuilt the shader`);
      fabricChecks += 1;
      fabricCoverage.set(id, (fabricCoverage.get(id) ?? 0) + 1);
    }
    for (const [mesh, color] of fixedColors) colorNear(colorOf(mesh), color, `${id}: shader recolor changed an unrelated mesh`);
    checkedMeshes += accessories.length;
    disposeOriginalAccessories(group);
  }
  assert.deepEqual(new Set(fabricCoverage.keys()), expectedFabricIds, 'Beanie, hat, beret, orb, and three_lobe must each exercise shader recoloring and native color reset');
  console.log(JSON.stringify({ status: 'passed', boundary: 'Settings persistence, native mesh/material color state; actual GPU and UI behavior require browser checks', accessories: CATALOG.accessories.length, paletteColors: CATALOG.colors.length, checkedMeshes, recolorChecks, fabricChecks, fabricCoverage: Object.fromEntries(fabricCoverage) }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
}
