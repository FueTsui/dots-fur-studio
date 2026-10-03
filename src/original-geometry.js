import * as THREE from 'three';

/** One original authored unit is one scene unit; the longest 2D body dimension is about 2. */
export const ORIGINAL_GEOMETRY_SCALE = 1;
export const ORIGINAL_GEOMETRY_BASE = `${import.meta.env?.BASE_URL ?? '/'}orbit/decoded/`;
let manifestPromise;
let fittedPromise;
const geometryPromises = new Map();

async function jsonFile(file) {
  const response = await fetch(`${ORIGINAL_GEOMETRY_BASE}${file}`);
  if (!response.ok) throw new Error(`Original Dots resource ${file}: HTTP ${response.status}`);
  return response.json();
}

export function loadOriginalGeometryManifest() {
  manifestPromise ??= jsonFile('manifest.json');
  return manifestPromise;
}

/** Returns the measured original bounds, topology, surface area, and resource hashes. */
export async function getGeometryMetrics(shapeId) {
  const manifest = await loadOriginalGeometryManifest();
  if (shapeId === undefined) return manifest.shapes;
  const entry = manifest.shapes[shapeId];
  if (!entry) throw new Error(`Unknown original Dots shape: ${shapeId}`);
  return entry;
}

export async function getOriginalMeshMetrics(meshId) {
  const manifest = await loadOriginalGeometryManifest();
  if (meshId === undefined) return manifest.meshes;
  const entry = manifest.meshes[meshId];
  if (!entry) throw new Error(`Unknown original Dots mesh: ${meshId}`);
  return entry;
}

/** Returns a clone so callers can transform/dispose their geometry independently. */
export async function loadOriginalGeometry(shapeId) {
  await getGeometryMetrics(shapeId);
  return loadOriginalMesh(shapeId);
}

/** Loads body or attachment mesh using its original resource basename (without extension). */
export async function loadOriginalMesh(shapeId) {
  if (!geometryPromises.has(shapeId)) {
    geometryPromises.set(shapeId, (async () => {
      const metrics = await getOriginalMeshMetrics(shapeId);
      const response = await fetch(`${ORIGINAL_GEOMETRY_BASE}${metrics.file}`);
      if (!response.ok) throw new Error(`Original Dots shape ${shapeId}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const expectedSize = metrics.vertexCount * 24 + metrics.indexCount * 4;
      if (bytes.byteLength !== expectedSize) throw new Error(`Invalid decoded mesh size: ${shapeId}`);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bytes, 0, metrics.vertexCount * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bytes, metrics.vertexCount * 12, metrics.vertexCount * 3), 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bytes, metrics.vertexCount * 24, metrics.indexCount), 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.name = `original-dots-${shapeId}`;
      geometry.userData = { source: 'original-dots-balanced-mesh', shapeId, metrics };
      return geometry;
    })());
  }
  try {
    return (await geometryPromises.get(shapeId)).clone();
  } catch (error) {
    geometryPromises.delete(shapeId);
    throw error;
  }
}

/** Original hash-keyed fit cache records; raw field semantics remain explicitly unresolved. */
export async function loadOriginalFittedRecords(shapeId) {
  fittedPromise ??= jsonFile('fitted-records.json');
  const records = (await fittedPromise).shapes;
  if (shapeId === undefined) return records;
  if (!records[shapeId]) throw new Error(`Unknown fitting-cache shape: ${shapeId}`);
  return records[shapeId];
}
