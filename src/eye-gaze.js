import * as THREE from 'three';

const PROFILE_URL = `${import.meta.env?.BASE_URL ?? '/'}orbit/gaze/profiles.json`;
let profilePromise;
const affineCorners = Array.from({ length: 4 }, () => new THREE.Matrix4());
const affineRows = [new THREE.Matrix4(), new THREE.Matrix4()];
const relative = new THREE.Matrix4(), relativeInverse = new THREE.Matrix4();
const generator = new THREE.Matrix4(), generatorSquared = new THREE.Matrix4(), fractional = new THREE.Matrix4();

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length < 3 || grid[0] !== -1 || grid.at(-1) !== 1 || !grid.includes(0)
    || grid.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= grid[index - 1]))) {
    throw new Error('Invalid original gaze sample grid');
  }
}

/** Validate the measured native affine field once, before the render loop uses it. */
export function validateGazeProfiles(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.grid) || data.grid.length < 3
    || !data.aliases || !data.profiles) throw new Error('Invalid original gaze profile schema');
  validateGrid(data.grid);
  for (const [name, profile] of Object.entries(data.profiles)) {
    if (!profile?.records || !Object.keys(profile.records).length) throw new Error(`Empty original gaze profile: ${name}`);
    const grid = profile.grid ?? data.grid;
    validateGrid(grid);
    const interpolation = profile.interpolation ?? 'bilinear';
    if (!['bilinear', 'biquadratic', 'affine-rotation'].includes(interpolation) || (interpolation === 'biquadratic' && grid.length !== 3)) throw new Error(`Invalid original gaze interpolation: ${name}`);
    for (const [key, poses] of Object.entries(profile.records)) {
      if (!Array.isArray(poses) || poses.length !== grid.length ** 2) throw new Error(`Incomplete original gaze samples: ${name}/${key}`);
      for (const matrix of poses) {
        if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) throw new Error(`Invalid original gaze matrix: ${name}/${key}`);
        if ([3, 7, 11].some((index) => Math.abs(matrix[index]) > 0.00001) || Math.abs(matrix[15] - 1) > 0.00001) throw new Error(`Non-affine original gaze matrix: ${name}/${key}`);
      }
    }
  }
  for (const [alias, key] of Object.entries(data.aliases)) {
    if (!Object.hasOwn(data.profiles, key)) throw new Error(`Missing original gaze alias target: ${alias}`);
  }
  return data;
}

export async function loadEyeGazeProfile(shape, faceFile) {
  if (!profilePromise) {
    profilePromise = (async () => {
      const response = await fetch(PROFILE_URL);
      if (!response.ok) throw new Error(`Original gaze profiles: HTTP ${response.status}`);
      return validateGazeProfiles(await response.json());
    })().catch((error) => { profilePromise = undefined; throw error; });
  }
  const data = await profilePromise;
  const alias = `${shape}/${faceFile}`;
  const key = data.aliases[alias] ?? alias;
  const profile = data.profiles[key];
  if (!profile) throw new Error(`Missing original gaze profile: ${alias}`);
  return { ...profile, grid: profile.grid ?? data.grid, interpolation: profile.interpolation ?? 'bilinear', source: key };
}

function interval(grid, value) {
  const input = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, -1, 1);
  let index = 0;
  while (index < grid.length - 2 && input > grid[index + 1]) index += 1;
  return [index, (input - grid[index]) / (grid[index + 1] - grid[index])];
}

function elementLerp(a, b, t, target) {
  for (let i = 0; i < 16; i += 1) target.elements[i] = a.elements[i] + (b.elements[i] - a.elements[i]) * t;
  return target;
}

/** A * (inverse(A) * B)^t, for a rotation expressed in a fitted affine basis. */
function interpolateAffineRotation(a, b, t, target) {
  if (t === 0) return target.copy(a);
  if (t === 1) return target.copy(b);
  // Native inset lids deliberately collapse. Their transform is not a rotation.
  if (Math.abs(a.determinant()) < 1e-8 || Math.abs(b.determinant()) < 1e-8) return elementLerp(a, b, t, target);
  relative.copy(a).invert().multiply(b);
  const r = relative.elements;
  const angle = Math.acos(THREE.MathUtils.clamp((r[0] + r[5] + r[10] - 1) * 0.5, -1, 1));
  const sine = Math.sin(angle);
  if (angle < 1e-5 || Math.abs(sine) < 1e-7) return elementLerp(a, b, t, target);
  relativeInverse.copy(relative).invert();
  const n = generator.elements, inverse = relativeInverse.elements;
  for (let i = 0; i < 16; i += 1) n[i] = (r[i] - inverse[i]) / (2 * sine);
  n[3] = n[7] = n[11] = n[15] = 0;
  generatorSquared.multiplyMatrices(generator, generator);
  fractional.identity();
  const s = Math.sin(t * angle), c = 1 - Math.cos(t * angle);
  for (let i = 0; i < 16; i += 1) fractional.elements[i] += s * n[i] + c * generatorSquared.elements[i];
  target.multiplyMatrices(a, fractional);
  // Retain exact affine homogeneous coordinates despite float capture noise.
  target.elements[3] = target.elements[7] = target.elements[11] = 0;
  target.elements[15] = 1;
  return target;
}

/**
 * Interpolation of sampled native transforms, including their shear. Smooth
 * surface eyes use a quadratic 3-by-3 field; inset eyes use a denser linear grid
 * with affine rotation powers. Native inset rotations are conjugated through a
 * fitted surface basis and are not orthogonal in prepared model coordinates.
 * Element interpolation shrinks them; quaternion projection erases their shear.
 * Decomposing these matrices into position/quaternion/scale would lose that shear.
 * x is right, y is up, both normalized to [-1, 1]. This is a sampled reconstruction.
 */
export function sampleEyeGazeMatrix(poses, grid, x, y, target = new THREE.Matrix4(), interpolation = 'bilinear') {
  if (interpolation === 'biquadratic') {
    const nx = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0, -1, 1);
    const ny = THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0, -1, 1);
    const wx = [nx * (nx - 1) * 0.5, 1 - nx * nx, nx * (nx + 1) * 0.5];
    const wy = [ny * (ny - 1) * 0.5, 1 - ny * ny, ny * (ny + 1) * 0.5];
    const values = target.elements;
    values.fill(0);
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
      const weight = wy[row] * wx[column], pose = poses[row * 3 + column];
      for (let index = 0; index < 16; index += 1) values[index] += pose[index] * weight;
    }
    return target;
  }
  const [ix, tx] = interval(grid, x);
  const [iy, ty] = interval(grid, y);
  const width = grid.length;
  const a = poses[iy * width + ix], b = poses[iy * width + ix + 1];
  const c = poses[(iy + 1) * width + ix], d = poses[(iy + 1) * width + ix + 1];
  if (interpolation === 'affine-rotation') {
    [a, b, c, d].forEach((pose, index) => affineCorners[index].fromArray(pose));
    interpolateAffineRotation(affineCorners[0], affineCorners[1], tx, affineRows[0]);
    interpolateAffineRotation(affineCorners[2], affineCorners[3], tx, affineRows[1]);
    return interpolateAffineRotation(affineRows[0], affineRows[1], ty, target);
  }
  const values = target.elements;
  for (let index = 0; index < 16; index += 1) {
    const low = a[index] + (b[index] - a[index]) * tx;
    const high = c[index] + (d[index] - c[index]) * tx;
    values[index] = low + (high - low) * ty;
  }
  return target;
}
