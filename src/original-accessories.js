import * as THREE from 'three';
import { normalizeAccessoryColors } from './settings.js';
import { loadEyeGazeProfile, sampleEyeGazeMatrix } from './eye-gaze.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}orbit/assemblies/`;
const recordsCache = new Map();
const EYE_IDS = new Set(['swept_lids', 'oval', 'sparkle_capsules', 'highlight_capsules', 'dots', 'double_highlights', 'round_inset', 'crescent_inset', 'sleepy_lids']);
const TRANSPARENT_EYEWEAR = new Set(['monocle', 'tall_oval_frames']);
const FABRIC_IDS = new Set(['beanie', 'beret', 'hat', 'orb', 'three_lobe']);

function assertId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]+$/.test(value)) throw new Error('Invalid original assembly identifier');
  return value;
}

function baseEye(shape) { return shape === 'rounded_head_two_ears' ? 'round_inset' : 'oval'; }

async function loadAssembly(shape, file) {
  const key = `${assertId(shape)}/${assertId(file)}`;
  if (!recordsCache.has(key)) {
    recordsCache.set(key, (async () => {
      const response = await fetch(`${BASE}${key}.json`);
      if (!response.ok) throw new Error(`Original Dots assembly ${key}: HTTP ${response.status}`);
      const result = await response.json();
      if (result.schemaVersion !== 1 || !Array.isArray(result.records)) throw new Error(`Invalid original assembly ${key}`);
      if (result.dataFile) {
        const binaryResponse = await fetch(`${BASE}${assertId(shape)}/${result.dataFile}`);
        if (!binaryResponse.ok) throw new Error(`Original Dots assembly binary ${key}: HTTP ${binaryResponse.status}`);
        const bytes = await binaryResponse.arrayBuffer();
        for (const record of result.records) {
          if (!record.binary) continue;
          record.position = new Float32Array(bytes, record.binary.positionOffset, record.vertexCount * 3);
          record.normal = new Float32Array(bytes, record.binary.normalOffset, record.vertexCount * 3);
          record.index = new Uint32Array(bytes, record.binary.indexOffset, record.indexCount);
        }
      }
      return result;
    })());
    // Bound long editing sessions while keeping frequently revisited choices fast.
    if (recordsCache.size > 48) recordsCache.delete(recordsCache.keys().next().value);
  }
  try {
    return await recordsCache.get(key);
  } catch (error) {
    recordsCache.delete(key);
    throw error;
  }
}

function geometryFromRecord(record) {
  if (!record.position || !record.normal || !record.index) throw new Error(`Original mesh data missing: ${record.name || 'body'}`);
  if (record.position.length !== record.vertexCount * 3 || record.normal.length !== record.vertexCount * 3 || record.index.length !== record.indexCount) throw new Error('Invalid original mesh dimensions');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(record.position), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(record.normal), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(record.index), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `original-prepared-${record.name || (record.isBody ? 'body' : 'part')}`;
  geometry.userData.originalKey = record.key;
  return geometry;
}

function recordMetrics(record, category, id) {
  return {
    category, id, nativeLabel: record.name, key: record.key,
    vertexCount: record.vertexCount, triangleCount: record.indexCount / 3,
    bounds: record.bounds, color: record.color, nativeAnchor: record.nativeAnchor,
    nativeMaterialFields: record.nativeMaterialFields,
    transform: 'identity: positions and normals are baked by the original runtime',
  };
}

/** Native body after the same preparation and depth fitting as its attachments. */
export async function loadPreparedBody(shapeId) {
  const data = await loadAssembly(shapeId, `eyes-${baseEye(shapeId)}`);
  const body = data.records.find((record) => record.isBody);
  if (!body) throw new Error(`Original prepared body missing: ${shapeId}`);
  const geometry = geometryFromRecord(body);
  geometry.userData.metrics = recordMetrics(body, 'shape', shapeId);
  geometry.userData.source = 'original-orbit-native-prepared-assembly';
  return geometry;
}

/** Builds exact native fitted meshes; only the Three.js light/material model is adapted. */
export async function loadOriginalAccessories(appearance) {
  const { shape, eyes, eyewear = 'none', accessories = [] } = appearance;
  if (accessories.length > 1) throw new Error('Original Dots allows at most one accessory');
  const nativeBaseEye = baseEye(shape);
  const hasGlasses = eyewear !== 'none';
  let faceFile = `eyes-${eyes}`;
  if (hasGlasses) {
    faceFile = TRANSPARENT_EYEWEAR.has(eyewear) && eyes !== nativeBaseEye
      ? `combo-${eyes}-${eyewear}` : `eyewear-${eyewear}`;
  }
  const [face, ...attachments] = await Promise.all([
    loadAssembly(shape, faceFile),
    ...accessories.map((id) => loadAssembly(shape, `accessories-${id}`)),
  ]);
  const group = new THREE.Group();
  group.name = `original-${shape}-accessories`;
  group.userData = { eyes: [], pupils: [], furParts: [], metrics: [], faceZones: [], source: 'original-orbit-native-prepared-assembly', materialMapping: 'original RGB with adapted Three.js standard lighting' };

  const eyeGroups = new Map();
  const eyeRecords = face.records.filter((record) => !record.isBody && EYE_IDS.has(record.name));
  const gaze = eyeRecords.length ? await loadEyeGazeProfile(shape, faceFile) : null;
  group.userData.gaze = { source: gaze?.source ?? null, lookX: 0, lookY: 0, reconstruction: 'sampled-native-affine-field' };
  for (const side of [-1, 1]) {
    const sideRecords = eyeRecords.filter((record) => Math.sign(record.nativeAnchor?.[0] ?? record.bounds.center[0]) === side);
    if (!sideRecords.length) continue;
    const box = new THREE.Box3();
    for (const record of sideRecords) {
      box.expandByPoint(new THREE.Vector3(...record.bounds.min));
      box.expandByPoint(new THREE.Vector3(...record.bounds.max));
    }
    const eyeGroup = new THREE.Group();
    eyeGroup.name = side < 0 ? 'eye-left' : 'eye-right';
    box.getCenter(eyeGroup.position);
    eyeGroup.userData.origin = eyeGroup.position.clone();
    eyeGroup.userData.gazeBounds = new THREE.Box3();
    eyeGroup.userData.inverseBlink = new THREE.Matrix4();
    eyeGroup.userData.blink = new THREE.Matrix4();
    eyeGroup.userData.toOrigin = new THREE.Matrix4().makeTranslation(...eyeGroup.position.toArray());
    eyeGroup.userData.fromOrigin = new THREE.Matrix4().makeTranslation(...eyeGroup.position.clone().negate().toArray());
    eyeGroup.userData.faceZone = { side, center: [0, 0, 0], size: [0, 0, 0] };
    group.userData.faceZones.push(eyeGroup.userData.faceZone);
    eyeGroups.set(side, eyeGroup);
    group.userData.eyes.push(eyeGroup);
    group.add(eyeGroup);
  }

  function addRecord(record, category, id) {
    const geometry = geometryFromRecord(record);
    const color = new THREE.Color().setRGB(...record.color, THREE.SRGBColorSpace);
    const fabric = category === 'accessories' && FABRIC_IDS.has(id);
    const crown = category === 'accessories' && id === 'crown';
    const material = fabric
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, envMapIntensity: 0.16 })
      // Adapt the reference crown's sharp, neutral highlights to our room lighting.
      // Color changes only update the base color, preserving this glossy finish.
      : crown ? new THREE.MeshPhysicalMaterial({
        color, roughness: 0.22, metalness: 0.32, specularIntensity: 1,
        envMapIntensity: 0.8, clearcoat: 0.7, clearcoatRoughness: 0.16,
      })
      : new THREE.MeshPhysicalMaterial({
        color, roughness: category === 'eyewear' ? 0.78 : 0.82,
        metalness: 0, specularIntensity: 0.14, envMapIntensity: 0.1,
      });
    material.userData.nativeRgb = record.color;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `original-${category}-${id}-${group.userData.metrics.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const metric = recordMetrics(record, category, id);
    mesh.userData.original = metric;
    group.userData.metrics.push(metric);
    const side = Math.sign(record.nativeAnchor?.[0] ?? record.bounds.center[0]);
    const eyeGroup = category === 'eyes' ? eyeGroups.get(side) : null;
    if (eyeGroup) {
      const poses = gaze.records[record.key];
      if (!poses) throw new Error(`Missing original gaze component: ${shape}/${faceFile}/${record.key}`);
      geometry.translate(-eyeGroup.position.x, -eyeGroup.position.y, -eyeGroup.position.z);
      mesh.matrixAutoUpdate = false;
      mesh.userData.gaze = {
        grid: gaze.grid, interpolation: gaze.interpolation, poses, matrix: new THREE.Matrix4(),
        bounds: new THREE.Box3(new THREE.Vector3(...record.bounds.min), new THREE.Vector3(...record.bounds.max)),
        transformedBounds: new THREE.Box3(),
      };
      eyeGroup.add(mesh);
    } else group.add(mesh);
    if (fabric) group.userData.furParts.push({ mesh, color: `#${color.getHexString()}`, source: 'native-fitted-mesh' });
  }

  for (const record of face.records) {
    if (record.isBody) continue;
    const isEye = EYE_IDS.has(record.name);
    addRecord(record, isEye ? 'eyes' : 'eyewear', isEye ? eyes : eyewear);
  }
  attachments.forEach((data, i) => {
    for (const record of data.records) {
      if (!record.isBody && !EYE_IDS.has(record.name)) addRecord(record, 'accessories', accessories[i]);
    }
  });
  updateOriginalAccessories(group);
  updateAccessoryColors(group, appearance.accessoryColors);
  return group;
}

/** Recolor existing accessory materials; keep authored RGB available for reset. */
export function updateAccessoryColors(group, colors = {}) {
  const overrides = normalizeAccessoryColors(colors);
  const color = new THREE.Color();
  group.traverse((mesh) => {
    const original = mesh.userData.original;
    if (!mesh.isMesh || original?.category !== 'accessories') return;
    const override = overrides[original.id];
    if (override) color.set(override);
    else color.setRGB(...original.color, THREE.SRGBColorSpace);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.uniforms?.uColor) material.uniforms.uColor.value.copy(color);
      else material.color?.copy(color);
    }
  });
  for (const part of group.userData.furParts ?? []) {
    const original = part.mesh.userData.original;
    if (overrides[original.id]) color.set(overrides[original.id]);
    else color.setRGB(...original.color, THREE.SRGBColorSpace);
    part.color = `#${color.getHexString()}`;
  }
  return group;
}

/** Independent native gaze per component; blinking does not pull the gaze back. */
export function updateOriginalAccessories(group, { blink = 0, lookX = 0, lookY = 0 } = {}) {
  const factor = 1 - THREE.MathUtils.clamp(Number.isFinite(blink) ? blink : 0, 0, 1) * 0.9;
  const x = THREE.MathUtils.clamp(Number.isFinite(lookX) ? lookX : 0, -1, 1);
  const y = THREE.MathUtils.clamp(Number.isFinite(lookY) ? lookY : 0, -1, 1);
  if (group.userData.gaze) Object.assign(group.userData.gaze, { lookX: x, lookY: y });
  for (const eye of group.userData.eyes ?? []) {
    eye.scale.y = factor;
    const data = eye.userData;
    data.inverseBlink.makeScale(1, 1 / factor, 1);
    data.blink.makeScale(1, factor, 1);
    data.gazeBounds.makeEmpty();
    for (const mesh of eye.children) {
      const component = mesh.userData.gaze;
      if (!component) continue;
      const matrix = sampleEyeGazeMatrix(component.poses, component.grid, x, y, component.matrix, component.interpolation);
      // Parent is T(origin) * S(blink); this conjugation yields the world result
      // R(gaze) * T(origin) * S(blink) for an authored mesh centered at origin.
      mesh.matrix.copy(data.inverseBlink).multiply(data.fromOrigin).multiply(matrix).multiply(data.toOrigin).multiply(data.blink);
      mesh.matrixWorldNeedsUpdate = true;
      component.transformedBounds.copy(component.bounds).applyMatrix4(matrix);
      data.gazeBounds.union(component.transformedBounds);
    }
    // Keep the fur opening with the gaze, but retain its size during a blink.
    data.gazeBounds.getCenter(_zoneCenter).toArray(data.faceZone.center);
    data.gazeBounds.getSize(_zoneSize).toArray(data.faceZone.size);
  }
}

const _zoneCenter = new THREE.Vector3();
const _zoneSize = new THREE.Vector3();

/** Explicit disposal; meshes returned above never share mutable GPU resources. */
export function disposeOriginalAccessories(group) {
  group.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
}
