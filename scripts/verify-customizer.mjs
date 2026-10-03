import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CATALOG, PARAMETER_DEFS, DEFAULT_APPEARANCE } from '../src/catalog.js';
import { normalizeAppearance, normalizeParameters, resolveBodyColor, loadSettings, saveSettings, STORAGE_KEY } from '../src/settings.js';
import { loadPreparedBody, loadOriginalAccessories, updateOriginalAccessories, disposeOriginalAccessories } from '../src/original-accessories.js';

// Integration checks against real packed public resources. No browser/WebGL is required.
// Execute only after pack-assemblies finishes, so the files form a stable snapshot.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'public');
const started = performance.now();
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const fetchedFiles = new Set();
let fetchCount = 0;
let fetchBytes = 0;
let geometryChecks = 0;
let vertexChecks = 0;
let indexChecks = 0;
let meshChecks = 0;
let normalMin = Infinity;
let normalMax = -Infinity;
const uniqueGeometry = new Set();
const coverage = { shapes: new Set(), eyes: new Set(), eyewear: new Set(), accessories: new Set() };
const storage = new Map();
const EPSILON = 0.00003;

globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); },
};
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://127.0.0.1');
  assert.equal(url.hostname, '127.0.0.1', 'The integration verifier must not access the network');
  const file = path.resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
  assert(file.startsWith(`${publicRoot}${path.sep}`), `Fetch escaped public/: ${url.pathname}`);
  fetchCount += 1;
  fetchedFiles.add(path.relative(publicRoot, file).replaceAll(path.sep, '/'));
  try {
    const bytes = await fs.readFile(file);
    fetchBytes += bytes.length;
    return new Response(bytes, { status: 200, headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response('', { status: 404 });
  }
};

function near(actual, expected, label, epsilon = EPSILON) {
  assert(Number.isFinite(actual) && Number.isFinite(expected), `${label}: nonfinite comparison`);
  assert(Math.abs(actual - expected) <= epsilon, `${label}: expected ${expected}, received ${actual}`);
}

function checkBounds(box, expected, label) {
  for (const side of ['min', 'max']) {
    for (let axis = 0; axis < 3; axis += 1) near(box[side].getComponent(axis), expected[side][axis], `${label}.${side}[${axis}]`);
  }
}

function checkGeometry(geometry, key) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  assert(position?.itemSize === 3 && position.count > 0, `${key}: missing positions`);
  assert(normal?.itemSize === 3 && normal.count === position.count, `${key}: invalid normal dimensions`);
  assert(index && index.count > 0 && index.count % 3 === 0, `${key}: invalid triangle indices`);
  assert(geometry.boundingBox && geometry.boundingSphere, `${key}: missing bounds`);
  assert(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0, `${key}: invalid bounding sphere`);
  // Packed component keys identify native geometry. Repeated material/combination
  // loads still check bounds and construction, without re-scanning millions of floats.
  if (uniqueGeometry.has(key)) return;
  uniqueGeometry.add(key);
  geometryChecks += 1;
  for (let i = 0; i < position.array.length; i += 1) {
    assert(Number.isFinite(position.array[i]), `${key}: nonfinite position at ${i}`);
    assert(Number.isFinite(normal.array[i]), `${key}: nonfinite normal at ${i}`);
  }
  for (let i = 0; i < position.count; i += 1) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    normalMin = Math.min(normalMin, length);
    normalMax = Math.max(normalMax, length);
    near(length, 1, `${key}: normal ${i}`, 0.002);
  }
  for (let i = 0; i < index.count; i += 1) assert(index.array[i] < position.count, `${key}: out-of-range index ${i}`);
  vertexChecks += position.count;
  indexChecks += index.count;
}

function checkGroup(group, appearance) {
  assert(group.isGroup && group.userData.source === 'original-orbit-native-prepared-assembly');
  assert(group.userData.metrics.length > 0, 'Expected native face/accessory components');
  group.updateMatrixWorld(true);
  const selectedAccessories = new Set();
  const selection = `${appearance.shape}/${appearance.eyes}/${appearance.eyewear}/${appearance.accessories.join(',') || 'none'}`;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    meshChecks += 1;
    const metric = mesh.userData.original;
    assert(metric && metric.key, `${selection}: missing native mesh provenance`);
    checkGeometry(mesh.geometry, `${appearance.shape}/${metric.key}`);
    const worldBounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    // Native eye matrices also control inset lids that are collapsed at rest.
    // Prepared vertex data remains unmodified; its rendered neutral bounds are
    // the authored bounds transformed by the measured native component matrix.
    const expectedBounds = mesh.userData.gaze
      ? new THREE.Box3(new THREE.Vector3(...metric.bounds.min), new THREE.Vector3(...metric.bounds.max)).applyMatrix4(mesh.userData.gaze.matrix)
      : null;
    checkBounds(worldBounds, expectedBounds ? { min: expectedBounds.min.toArray(), max: expectedBounds.max.toArray() } : metric.bounds, `${selection}/${mesh.name}`);
    assert(mesh.material.isMeshStandardMaterial, `${selection}: unexpected material`);
    for (const value of [mesh.material.color.r, mesh.material.color.g, mesh.material.color.b, mesh.material.roughness, mesh.material.metalness]) assert(Number.isFinite(value), `${selection}: nonfinite material`);
    assert(mesh.material.roughness >= 0 && mesh.material.roughness <= 1);
    assert(mesh.material.metalness >= 0 && mesh.material.metalness <= 1);
    assert.deepEqual(mesh.material.userData.nativeRgb, metric.color, `${selection}: source color lost`);
    if (metric.category === 'accessories') selectedAccessories.add(metric.id);
  });
  assert.deepEqual([...selectedAccessories].sort(), [...appearance.accessories].sort(), `${selection}: incorrect accessories`);
  const origins = group.userData.eyes.map((eye) => eye.position.clone());
  updateOriginalAccessories(group, { blink: 1 });
  group.userData.eyes.forEach((eye, i) => {
    near(eye.scale.y, 0.1, 'Blink should close around the authored eye center');
    assert(eye.position.equals(origins[i]), 'Blink must preserve the native eye position');
  });
  updateOriginalAccessories(group, { blink: 0 });
  group.userData.eyes.forEach((eye) => near(eye.scale.y, 1, 'Blink should restore rest geometry'));
  for (const [category, id] of [['shapes', appearance.shape], ['eyes', appearance.eyes], ['eyewear', appearance.eyewear]]) coverage[category].add(id);
  appearance.accessories.forEach((id) => coverage.accessories.add(id));
}

function checkSettings() {
  assert.deepEqual(normalizeAppearance(null), normalizeAppearance(DEFAULT_APPEARANCE));
  assert.deepEqual(normalizeAppearance({ shape: '../../bad', eyes: 'unknown', color: '#fake', eyewear: 'bad', accessories: ['bad'], name: '  ' }), normalizeAppearance(DEFAULT_APPEARANCE));
  assert.equal(normalizeAppearance({ name: '甲'.repeat(50) }).name.length, 30);
  assert.equal(normalizeAppearance({ name: '  番薯  ' }).name, '番薯');
  assert.equal(normalizeAppearance({ shape: 'rounded_head_two_ears', eyes: 'oval' }).eyes, 'round_inset');
  assert.equal(normalizeAppearance({ shape: 'circle', eyes: 'round_inset' }).eyes, 'oval');
  const defaultBodyHex = CATALOG.colors.find(entry => entry.id === DEFAULT_APPEARANCE.color).hex;
  for (const { id, hex } of CATALOG.colors) {
    assert.equal(normalizeAppearance({ color: id }).color, id, `Preset color ID must remain compatible: ${id}`);
    assert.equal(resolveBodyColor(id), hex, `Preset color must resolve to its palette RGB: ${id}`);
  }
  for (const [input, expected] of [['#ABC', '#aabbcc'], ['#12ABef', '#12abef'], ['#000', '#000000'], ['#FFFfff', '#ffffff'], [' #F0a ', '#ff00aa']]) {
    assert.equal(normalizeAppearance({ color: input }).color, expected, `Custom body color must normalize: ${input}`);
    assert.equal(resolveBodyColor(input), expected, `Body renderer must receive normalized RGB: ${input}`);
  }
  for (const invalid of [undefined, null, 0, NaN, Infinity, {}, [], 'red', 'rgb(1,2,3)', '#12', '#1234', '#12345', '#1234567', '#12345678', '#ggg', 'constructor', '__proto__']) {
    assert.equal(normalizeAppearance({ color: invalid }).color, DEFAULT_APPEARANCE.color, `Invalid body color must restore the default preset: ${String(invalid)}`);
    assert.equal(resolveBodyColor(invalid), defaultBodyHex, `Invalid renderer color must resolve to default pink: ${String(invalid)}`);
  }
  const customAppearance = normalizeAppearance({ ...DEFAULT_APPEARANCE, color: '#1aB2c3', accessories: ['bow'], accessoryColors: { bow: '#fedcba' } });
  for (const { id } of CATALOG.shapes) {
    const changed = normalizeAppearance({ ...customAppearance, shape: id });
    assert.equal(changed.color, '#1ab2c3', `Changing shape must preserve the custom body color: ${id}`);
    assert.deepEqual(changed.accessoryColors, customAppearance.accessoryColors, 'Changing shape must not overwrite accessory colors');
  }
  for (const accessories of [[], ...CATALOG.accessories.map(({ id }) => [id])]) {
    const changed = normalizeAppearance({ ...customAppearance, accessories, accessoryColors: { ...customAppearance.accessoryColors, [accessories[0] ?? 'bow']: '#012345' } });
    assert.equal(changed.color, '#1ab2c3', 'Changing or recoloring an accessory must preserve the custom body color');
  }
  const accessoryIds = CATALOG.accessories.map((entry) => entry.id);
  for (const first of accessoryIds) {
    for (const last of accessoryIds) {
      const normalized = normalizeAppearance({ shape: 'rounded_triangle', accessories: [first, last, 'invalid'] });
      assert.deepEqual(normalized.accessories, [last], 'Native accessory selection is single-choice, including different slots');
    }
  }
  for (const shape of ['rounded_head_two_ears', 'circle_two_ears']) {
    assert.deepEqual(normalizeAppearance({ shape, accessories: ['crown'] }).accessories, []);
    assert.deepEqual(normalizeAppearance({ shape, accessories: ['headphones'] }).accessories, ['headphones']);
    assert.deepEqual(normalizeAppearance({ shape, accessories: ['bow'] }).accessories, ['bow']);
  }
  for (const invalid of [null, undefined, '3', NaN, Infinity, -Infinity, {}, []]) {
    const normalized = normalizeParameters(Object.fromEntries(PARAMETER_DEFS.map((p) => [p.id, invalid])));
    for (const parameter of PARAMETER_DEFS) assert.equal(normalized[parameter.id], parameter.default, `Invalid ${parameter.id} should use its default`);
  }
  for (const parameter of PARAMETER_DEFS) {
    assert.equal(normalizeParameters({ [parameter.id]: parameter.min - 1000 })[parameter.id], parameter.min);
    assert.equal(normalizeParameters({ [parameter.id]: parameter.max + 1000 })[parameter.id], parameter.max);
    const interior = (parameter.min + parameter.max) / 2;
    assert.equal(normalizeParameters({ [parameter.id]: interior })[parameter.id], interior);
  }
  for (const corrupt of ['{', 'null', '[]', '{"version":1}', '{"version":99}']) {
    storage.set(STORAGE_KEY, corrupt);
    assert.equal(loadSettings(), null, `Invalid localStorage payload ${corrupt}`);
  }
  storage.set(STORAGE_KEY, JSON.stringify({ version: 2, appearance: { shape: 'invalid', accessories: ['bow', 'beret'] }, parameters: { length: -5, density: '500', bright: null }, quality: 'extreme' }));
  const repaired = loadSettings();
  assert.equal(repaired.appearance.shape, DEFAULT_APPEARANCE.shape);
  assert.deepEqual(repaired.appearance.accessories, ['beret']);
  assert.equal(repaired.parameters.length, PARAMETER_DEFS.find((entry) => entry.id === 'length').min);
  assert.equal(repaired.parameters.density, PARAMETER_DEFS.find((entry) => entry.id === 'density').default);
  assert.equal(repaired.parameters.bright, PARAMETER_DEFS.find((entry) => entry.id === 'bright').default);
  assert.equal(repaired.quality, 'auto');
  saveSettings(repaired);
  assert.deepEqual(loadSettings(), repaired, 'Normalized settings should survive a localStorage round trip');
  // Existing v2 records keep palette IDs; custom RGB uses the same version and
  // survives storage without converting the independent accessory palette.
  for (const { id, hex } of CATALOG.colors) {
    const legacy = { version: 2, appearance: { ...DEFAULT_APPEARANCE, color: id }, parameters: normalizeParameters(), quality: 'medium' };
    delete legacy.appearance.accessoryColors;
    storage.set(STORAGE_KEY, JSON.stringify(legacy));
    const restored = loadSettings();
    assert.equal(restored.appearance.color, id, `Old saved preset ID must remain unchanged: ${id}`);
    assert.equal(resolveBodyColor(restored.appearance.color), hex);
    assert.deepEqual(restored.appearance.accessoryColors, {}, 'Legacy body colors must not create accessory overrides');
  }
  const customSettings = { appearance: customAppearance, parameters: normalizeParameters(), quality: 'high' };
  saveSettings(customSettings);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).version, 2, 'Custom body colors must remain compatible with v2 storage');
  assert.deepEqual(loadSettings(), customSettings, 'Custom body and accessory colors must survive save/load independently');
  storage.set(STORAGE_KEY, JSON.stringify({ version: 2, ...customSettings, appearance: { ...customAppearance, color: '#AbC' } }));
  assert.equal(loadSettings().appearance.color, '#aabbcc', 'Imported short body colors must normalize on load');
  storage.set(STORAGE_KEY, JSON.stringify({ version: 2, ...customSettings, appearance: { ...customAppearance, color: '#invalid' } }));
  assert.equal(loadSettings().appearance.color, DEFAULT_APPEARANCE.color, 'Invalid saved body colors must fall back to default pink');
  assert.deepEqual(loadSettings().appearance.accessoryColors, customAppearance.accessoryColors, 'Repairing a body color must preserve accessory colors');
  storage.clear();
}

try {
  checkSettings();
  // This explicit refusal prevents accidental layering of mutually exclusive hats.
  await assert.rejects(() => loadOriginalAccessories({ ...DEFAULT_APPEARANCE, accessories: ['bow', 'beret'] }), /at most one accessory/);
  let sampledAppearances = 0;
  let legalMatrixAppearances = 0;
  const shapeResults = [];
  for (const shapeEntry of CATALOG.shapes) {
    const shape = shapeEntry.id;
    const normalizedEyes = [...new Set(CATALOG.eyes.map((entry) => normalizeAppearance({ shape, eyes: entry.id }).eyes))];
    const choices = [[], ...CATALOG.accessories.map((entry) => normalizeAppearance({ shape, accessories: [entry.id] }).accessories).filter((ids) => ids.length)];
    const uniqueChoices = [...new Map(choices.map((ids) => [ids.join(','), ids])).values()];
    legalMatrixAppearances += normalizedEyes.length * CATALOG.eyewear.length * uniqueChoices.length;
    const body = await loadPreparedBody(shape);
    const baseEye = normalizeAppearance({ shape, eyes: DEFAULT_APPEARANCE.eyes }).eyes;
    const baseData = JSON.parse(await fs.readFile(path.join(publicRoot, 'orbit/assemblies', shape, `eyes-${baseEye}.json`), 'utf8'));
    const prepared = baseData.records.find((record) => record.isBody);
    checkGeometry(body, `${shape}/body`);
    checkBounds(body.boundingBox, prepared.bounds, `${shape}: native prepared body`);
    assert.equal(body.getAttribute('position').count, prepared.vertexCount);
    assert.equal(body.getIndex().count, prepared.indexCount);
    assert.equal(body.userData.source, 'original-orbit-native-prepared-assembly');
    const size = body.boundingBox.getSize(new THREE.Vector3());
    if (shape === 'rounded_triangle') near(size.z, 1.6004483699798584, 'Known native triangle depth');
    body.dispose();
    const sampleStart = sampledAppearances;
    let choice = 0;
    // Each legal eyes × eyewear pair is constructed. Accessory choices rotate so
    // every permitted accessory is built for each shape, without repeatedly
    // cloning the identical meshes for the full independent Cartesian product.
    for (const eyes of normalizedEyes) {
      for (const eyewearEntry of CATALOG.eyewear) {
        const appearance = normalizeAppearance({ shape, eyes, eyewear: eyewearEntry.id, accessories: uniqueChoices[choice % uniqueChoices.length] });
        choice += 1;
        const group = await loadOriginalAccessories(appearance);
        checkGroup(group, appearance);
        disposeOriginalAccessories(group);
        sampledAppearances += 1;
      }
    }
    // A shape with fewer eye/glasses pairs must still exercise every accessory.
    for (; choice < uniqueChoices.length; choice += 1) {
      const appearance = normalizeAppearance({ shape, accessories: uniqueChoices[choice] });
      const group = await loadOriginalAccessories(appearance);
      checkGroup(group, appearance);
      disposeOriginalAccessories(group);
      sampledAppearances += 1;
    }
    shapeResults.push({ shape, legalEyes: normalizedEyes.length, legalEyewear: CATALOG.eyewear.length, accessoryChoicesIncludingNone: uniqueChoices.length, testedAppearances: sampledAppearances - sampleStart, preparedBodySize: size.toArray() });
  }
  for (const category of ['shapes', 'eyes', 'eyewear', 'accessories']) {
    const expected = CATALOG[category].map((entry) => entry.id);
    for (const id of expected) assert(coverage[category].has(id), `Catalog item not exercised: ${category}/${id}`);
  }
  // Cached raw records must remain reusable after callers dispose their clones.
  const first = await loadOriginalAccessories(DEFAULT_APPEARANCE);
  const second = await loadOriginalAccessories(DEFAULT_APPEARANCE);
  const firstMeshes = []; const secondMeshes = [];
  first.traverse((object) => { if (object.isMesh) firstMeshes.push(object); });
  second.traverse((object) => { if (object.isMesh) secondMeshes.push(object); });
  assert(firstMeshes.length > 0 && firstMeshes.length === secondMeshes.length);
  firstMeshes.forEach((mesh, i) => {
    assert.notEqual(mesh.geometry, secondMeshes[i].geometry, 'Mutable geometry must not be shared');
    assert.notEqual(mesh.material, secondMeshes[i].material, 'Mutable material must not be shared');
    assert.notEqual(mesh.geometry.getAttribute('position').array, secondMeshes[i].geometry.getAttribute('position').array);
  });
  disposeOriginalAccessories(first);
  checkGroup(second, DEFAULT_APPEARANCE);
  disposeOriginalAccessories(second);
  console.log(JSON.stringify({
    status: 'passed', boundary: 'Node integration: packed files, Three.js CPU geometry/material construction, settings, and native bounds; no browser or GPU rendering',
    legalMatrixAppearances, sampledAppearances, testedEyeEyewearPairs: shapeResults.reduce((total, entry) => total + entry.legalEyes * entry.legalEyewear, 0),
    uniqueGeometryChecks: geometryChecks, constructedMeshChecks: meshChecks, inspectedVertices: vertexChecks, inspectedIndices: indexChecks,
    normalLengthRange: [normalMin, normalMax], catalogCoverage: Object.fromEntries(Object.entries(coverage).map(([key, value]) => [key, value.size])),
    fetchedUniqueFiles: fetchedFiles.size, fetchCount, fetchBytes, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), shapeResults,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
}
