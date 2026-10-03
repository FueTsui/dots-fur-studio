import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { DEFAULT_APPEARANCE } from '../src/catalog.js';
import { validateGazeProfiles, sampleEyeGazeMatrix } from '../src/eye-gaze.js';
import { loadOriginalAccessories, updateOriginalAccessories, disposeOriginalAccessories } from '../src/original-accessories.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const data = validateGazeProfiles(JSON.parse(await fs.readFile(path.join(publicRoot, 'orbit/gaze/profiles.json'), 'utf8')));
const savedFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(input, 'http://127.0.0.1');
  assert.equal(url.hostname, '127.0.0.1', 'Verification must not access the network');
  const file = path.resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
  assert(file.startsWith(`${publicRoot}${path.sep}`));
  try { return new Response(await fs.readFile(file), { status: 200 }); }
  catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error; }
};

function near(a, b, label, tolerance = 0.000003) {
  assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b}`);
}
function matrixNear(a, b, label) { a.forEach((value, i) => near(value, b[i], `${label}[${i}]`)); }
function vectorNear(a, b, label) { a.forEach((value, i) => near(value, b[i], `${label}[${i}]`)); }

let sampledMatrices = 0;
let checkedComponents = 0;
let checkedAppearances = 0;
const matrix = new THREE.Matrix4();

try {
  // Native inset rotation lives inside a sheared surface basis. Check a known
  // non-orthogonal conjugation so quaternion projection/element lerp cannot
  // silently flatten the bright component back inside its dark eyeball.
  const basis = new THREE.Matrix4().set(
    1.3, 0.6, -0.2, -0.3,
    0.15, 0.9, 0.35, 0.2,
    0.1, -0.2, 1.1, 0.7,
    0, 0, 0, 1,
  );
  const basisInverse = basis.clone().invert();
  const rotationAt = (x, y) => basis.clone()
    .multiply(new THREE.Matrix4().makeRotationY(y * 0.55))
    .multiply(new THREE.Matrix4().makeRotationX(x * 0.65))
    .multiply(basisInverse);
  const rotationGrid = [-1, 0, 1];
  const rotationPoses = rotationGrid.flatMap((y) => rotationGrid.map((x) => rotationAt(x, y).elements));
  for (const [x, y] of [[0.15, -0.27], [-0.8, 0.45], [0.6, 0.7]]) {
    const actual = sampleEyeGazeMatrix(rotationPoses, rotationGrid, x, y, new THREE.Matrix4(), 'affine-rotation');
    matrixNear(actual.elements, rotationAt(x, y).elements, 'Affine rotation preserves the fitted shear');
    const surface = new THREE.Vector3(0.2, 0.4, Math.sqrt(0.8)).applyMatrix4(basis);
    near(surface.applyMatrix4(actual).applyMatrix4(basisInverse).length(), 1, 'An inset surface point keeps its ellipsoid radius');
  }
  const collapsed = rotationGrid.flatMap((y) => rotationGrid.map((x) => new THREE.Matrix4().makeScale(1e-5, 1e-8, 1e-5).setPosition(x * 0.1, y * 0.1, 0).elements));
  matrixNear(
    sampleEyeGazeMatrix(collapsed, rotationGrid, 0.2, -0.4, new THREE.Matrix4(), 'affine-rotation').elements,
    sampleEyeGazeMatrix(collapsed, rotationGrid, 0.2, -0.4, new THREE.Matrix4(), 'bilinear').elements,
    'Collapsed native lids bypass rotation reconstruction',
  );

  // Every native sample must be recovered exactly; retain shear as well as translation.
  for (const [name, profile] of Object.entries(data.profiles)) {
    const grid = profile.grid ?? data.grid;
    const interpolation = profile.interpolation ?? 'bilinear';
    const neutral = grid.indexOf(0) * grid.length + grid.indexOf(0);
    for (const [key, poses] of Object.entries(profile.records)) {
      grid.forEach((y, row) => grid.forEach((x, column) => {
        sampleEyeGazeMatrix(poses, grid, x, y, matrix, interpolation);
        matrixNear(matrix.elements, poses[row * grid.length + column], `${name}/${key}`);
        sampledMatrices += 1;
      }));
      sampleEyeGazeMatrix(poses, grid, NaN, Infinity, matrix, interpolation);
      matrixNear(matrix.elements, poses[neutral], 'Invalid input resets to neutral');
      sampleEyeGazeMatrix(poses, grid, 100, -100, matrix, interpolation);
      matrixNear(matrix.elements, poses[grid.length - 1], 'Out-of-range input is clamped');
      for (const [x, y] of [[0.13, -0.61], [-0.75, 0.4], [0.5, 0.5]]) {
        sampleEyeGazeMatrix(poses, grid, x, y, matrix, interpolation);
        // Native inset eyelids deliberately collapse at rest. Keep those sampled
        // matrices instead of replacing them with an artificial unit transform.
        assert(matrix.elements.every(Number.isFinite), 'Interpolated gaze must be finite');
      }
    }
  }

  // Assemble real source meshes for all eye styles and both transparent frame styles.
  const selections = [];
  for (const eyes of ['swept_lids', 'oval', 'sparkle_capsules', 'highlight_capsules', 'dots', 'double_highlights', 'crescent_inset', 'sleepy_lids']) {
    for (const eyewear of ['none', 'monocle', 'tall_oval_frames']) selections.push({ ...DEFAULT_APPEARANCE, eyes, eyewear });
  }
  for (const eyewear of ['none', 'monocle', 'tall_oval_frames']) selections.push({ ...DEFAULT_APPEARANCE, shape: 'rounded_head_two_ears', eyes: 'round_inset', eyewear });
  const { CATALOG } = await import('../src/catalog.js');
  for (const eyewear of CATALOG.eyewear.filter((item) => !['none', 'monocle', 'tall_oval_frames'].includes(item.id))) selections.push({ ...DEFAULT_APPEARANCE, eyewear: eyewear.id });

  for (const appearance of selections) {
    const group = await loadOriginalAccessories(appearance);
    group.updateMatrixWorld(true);
    const eyes = [];
    const staticParts = [];
    group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (mesh.userData.gaze) eyes.push(mesh);
      else staticParts.push({ mesh, matrix: mesh.matrixWorld.clone() });
    });
    assert.equal(eyes.length, group.userData.metrics.filter((record) => record.category === 'eyes').length, 'Every native eye component needs its own transform');
    for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [0.4, -0.6]]) {
      updateOriginalAccessories(group, { lookX: x, lookY: y });
      group.updateMatrixWorld(true);
      for (const mesh of eyes) {
        const component = mesh.userData.gaze;
        const expected = sampleEyeGazeMatrix(component.poses, component.grid, x, y, new THREE.Matrix4(), component.interpolation);
        const actual = mesh.matrixWorld.clone().multiply(mesh.parent.userData.fromOrigin);
        matrixNear(actual.elements, expected.elements, 'Mesh world transform preserves the native affine field');
        assert(mesh.matrixWorld.elements.every(Number.isFinite));
        checkedComponents += 1;
      }
      for (const { mesh, matrix: before } of staticParts) matrixNear(mesh.matrixWorld.elements, before.elements, 'Eyewear/accessories must stay fixed');
      const zones = JSON.stringify(group.userData.faceZones);
      for (const zone of group.userData.faceZones) {
        assert([...zone.center, ...zone.size].every(Number.isFinite));
        assert(zone.size.every((value) => value > 0));
        const sideMeshes = eyes.filter((mesh) => Math.sign(mesh.userData.original.nativeAnchor[0]) === zone.side);
        const union = new THREE.Box3();
        for (const mesh of sideMeshes) union.union(mesh.userData.gaze.bounds.clone().applyMatrix4(mesh.userData.gaze.matrix));
        vectorNear(zone.center, union.getCenter(new THREE.Vector3()).toArray(), 'Fur mask follows the eye center');
        vectorNear(zone.size, union.getSize(new THREE.Vector3()).toArray(), 'Fur mask contains the moving eye components');
      }
      const centers = eyes.map((mesh) => new THREE.Vector3().applyMatrix4(mesh.matrixWorld).toArray());
      updateOriginalAccessories(group, { lookX: x, lookY: y, blink: 1 });
      group.updateMatrixWorld(true);
      assert.equal(JSON.stringify(group.userData.faceZones), zones, 'Blink must not shrink the fur opening');
      eyes.forEach((mesh, index) => vectorNear(new THREE.Vector3().applyMatrix4(mesh.matrixWorld).toArray(), centers[index], 'Blink must not drag the gaze toward neutral'));
    }
    // Repeated frames and returning to center must never accumulate transforms.
    for (let i = 0; i < 20; i += 1) updateOriginalAccessories(group, { lookX: 0.8, lookY: -0.4, blink: 0.5 });
    updateOriginalAccessories(group, { lookX: 0, lookY: 0 });
    group.updateMatrixWorld(true);
    for (const mesh of eyes) {
      const actual = mesh.matrixWorld.clone().multiply(mesh.parent.userData.fromOrigin);
      const component = mesh.userData.gaze;
      const neutral = component.grid.indexOf(0) * component.grid.length + component.grid.indexOf(0);
      matrixNear(actual.elements, component.poses[neutral], 'Return to center restores native neutral geometry');
      assert(mesh.parent.position.equals(mesh.parent.userData.origin), 'Authored eye origin must stay intact');
    }
    if (eyes.length === 0) assert.deepEqual(group.userData.faceZones, [], 'Sunglasses must not create hidden eyes or fur openings');
    disposeOriginalAccessories(group);
    checkedAppearances += 1;
  }
  console.log(JSON.stringify({ status: 'passed', boundary: 'Native sample data and Three.js CPU transforms; browser/GPU appearance requires separate visual checks', profileCount: Object.keys(data.profiles).length, aliases: Object.keys(data.aliases).length, sampledMatrices, checkedAppearances, checkedComponents }, null, 2));
} finally {
  globalThis.fetch = savedFetch;
}
