import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createGazeMotion, stepGazeMotion, GAZE_MOTION } from '../src/gaze-motion.js';
import { mapGazeInput, GAZE_PRESENTATION } from '../src/gaze-input.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samples = JSON.parse(await fs.readFile(path.join(root, GAZE_MOTION.source), 'utf8'));
const assembly = JSON.parse(await fs.readFile(path.join(root, 'public/orbit/assemblies/rounded_triangle/eyes-oval.json'), 'utf8'));
const anchor = new THREE.Vector3(...assembly.records[1].nativeAnchor);
const body = new THREE.Matrix4(), eye = new THREE.Matrix4();
const position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const extracted = samples.map((sample) => {
  body.fromArray(sample.draws.find((draw) => draw.offset === 0).world);
  eye.fromArray(sample.draws.find((draw) => draw.offset === 512).world);
  body.decompose(position, quaternion, scale);
  const head = euler.setFromQuaternion(quaternion, 'YXZ').y / 0.055;
  const eyes = anchor.clone().applyMatrix4(body.clone().invert().multiply(eye)).x - anchor.x;
  return { seconds: sample.seconds, eyes, head };
});
const start = extracted[0].eyes, end = extracted.at(-1).eyes;
assert(end - start > 0.04 && end - start < 0.043, 'Unexpected native triangle-oval eye travel');
extracted.forEach((sample) => { sample.eyes = (sample.eyes - start) / (end - start); });

function near(actual, expected, message, tolerance = 1e-12) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}
function compareStates(actual, expected, label) {
  for (const part of ['eyes', 'head']) for (const field of ['x', 'y', 'vx', 'vy']) near(actual[part][field], expected[part][field], `${label}/${part}/${field}`);
}
function assertBounded(state) {
  for (const part of ['eyes', 'head']) {
    assert(Object.values(state[part]).every(Number.isFinite), `${part}: nonfinite spring state`);
    assert(Math.abs(state[part].x) <= 1 && Math.abs(state[part].y) <= 1, `${part}: gaze escaped its range`);
  }
}

// Rebuild the captured response using actual capture times after its scheduling
// offset. This tests the source evidence, rather than only the spring formula.
const fit = {};
for (const part of ['eyes', 'head']) {
  const state = createGazeMotion();
  let prior = 0, squaredError = 0, maxError = 0;
  for (const sample of extracted) {
    const elapsed = Math.max(0, sample.seconds - GAZE_MOTION[part].captureSchedulingOffsetSeconds);
    stepGazeMotion(state, 1, 0, elapsed - prior);
    prior = elapsed;
    const difference = Math.abs(state[part].x - sample[part]);
    squaredError += difference ** 2;
    maxError = Math.max(maxError, difference);
  }
  fit[part] = { rmsFraction: Math.sqrt(squaredError / extracted.length), maxFraction: maxError };
  assert(fit[part].rmsFraction < (part === 'eyes' ? 0.008 : 0.004), `${part}: fit drifted away from the native response`);
  assert(maxError < (part === 'eyes' ? 0.05 : 0.025), `${part}: unacceptable peak response error`);
}

// Identical step and return schedules at different frame rates must agree.
const snapshots = [];
for (const fps of [30, 60, 120]) {
  const state = createGazeMotion();
  for (const [x, y, seconds] of [[1, -1, 0.2], [-0.6, 0.8, 0.3], [0, 0, 0.5]]) {
    for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) {
      stepGazeMotion(state, x, y, 1 / fps);
      assertBounded(state);
    }
    snapshots.push({ fps, x, y, state: structuredClone(state) });
  }
}
for (let stage = 0; stage < 3; stage += 1) {
  compareStates(snapshots[stage].state, snapshots[3 + stage].state, '30 vs 60 fps');
  compareStates(snapshots[stage].state, snapshots[6 + stage].state, '30 vs 120 fps');
}

const monotone = createGazeMotion();
let lastEye = 0, lastHead = 0;
for (let frame = 0; frame < 120; frame += 1) {
  stepGazeMotion(monotone, 1, 1, 1 / 120);
  assert(monotone.eyes.x >= lastEye && monotone.head.x >= lastHead, 'Stationary step must settle monotonically');
  assert(monotone.eyes.x >= monotone.head.x, 'The eyes should lead the head');
  assertBounded(monotone);
  lastEye = monotone.eyes.x; lastHead = monotone.head.x;
}
for (let frame = 0; frame < 120; frame += 1) {
  stepGazeMotion(monotone, 0, 0, 1 / 120);
  assertBounded(monotone);
}
for (const part of ['eyes', 'head']) {
  near(monotone[part].x, 0, `${part}: return to center`, 1e-8);
  near(monotone[part].y, 0, `${part}: return to center`, 1e-8);
}

const rapid = createGazeMotion();
for (let frame = 0; frame < 360; frame += 1) {
  stepGazeMotion(rapid, frame % 7 < 3 ? 1 : -1, Math.sin(frame * 0.7), 1 / 120);
  assertBounded(rapid);
}
const frozen = structuredClone(rapid);
for (const dt of [0, -1, NaN, Infinity]) stepGazeMotion(rapid, 1, 1, dt);
compareStates(rapid, frozen, 'Invalid/zero dt leaves the spring unchanged');
stepGazeMotion(rapid, NaN, Infinity, 1000);
assert.deepEqual(rapid, createGazeMotion(), 'Invalid targets and a long gap settle safely at center');

// The presentation layer amplifies small pointer movements before the original
// spring and native eye field. Assert the visible behavior rather than copying
// its transfer formula into the verifier.
near(mapGazeInput(0), 0, 'Centered input stays centered');
near(mapGazeInput(1), 1, 'Right/up edge reaches the native gaze limit');
near(mapGazeInput(-1), -1, 'Left/down edge reaches the native gaze limit');
for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '0.5', {}, []]) {
  near(mapGazeInput(invalid), 0, 'Invalid pointer coordinates return to center');
}
for (const outside of [1.001, 10, Number.MAX_VALUE]) {
  near(mapGazeInput(outside), 1, 'Large positive input is bounded');
  near(mapGazeInput(-outside), -1, 'Large negative input is bounded');
}
let previousInput = -Infinity;
for (let i = 0; i <= 200; i += 1) {
  const input = -1 + i / 100;
  const mapped = mapGazeInput(input);
  assert(Number.isFinite(mapped) && mapped >= -1 && mapped <= 1, 'Mapped gaze must be finite and inside the native field');
  assert(mapped > previousInput, 'Pointer response must stay strictly monotonic without an early flat limit');
  near(mapGazeInput(-input), -mapped, 'Opposite pointer positions must have symmetric responses');
  if (Math.abs(input) < 1) assert(Math.abs(mapped) < 1, 'Interior pointer positions must not reach the hard gaze limit');
  previousInput = mapped;
}
const amplifiedSamples = [0.1, 0.25, 0.5].map(input => ({ input, mapped: mapGazeInput(input) }));
for (const { input, mapped } of amplifiedSamples) {
  assert(mapped / input > (input < 0.5 ? 1.8 : 1.5), 'Small and medium pointer movements must produce a visible gain');
  assert(mapped < 0.9, 'Medium pointer movements must retain room before the edge');
}
assert(GAZE_PRESENTATION.headYaw > 0.055 * 1.4 && GAZE_PRESENTATION.headYaw < 0.055 * 1.7, 'Presentation yaw should be approximately 1.5 times the native range');
assert(GAZE_PRESENTATION.headPitch < -0.035 * 1.4 && GAZE_PRESENTATION.headPitch > -0.035 * 1.7, 'Presentation pitch should increase its range while preserving the up/down direction');
near(GAZE_MOTION.eyes.angularFrequency, 52.5, 'Eye damping fit remains unchanged');
near(GAZE_MOTION.head.angularFrequency, 22.3, 'Head damping fit remains unchanged');

for (const fps of [30, 60, 120]) {
  const presented = createGazeMotion();
  const reference = createGazeMotion();
  for (let frame = 0; frame < fps / 10; frame += 1) {
    stepGazeMotion(presented, mapGazeInput(0.1), mapGazeInput(-0.1), 1 / fps);
    stepGazeMotion(reference, 0.1, -0.1, 1 / fps);
  }
  for (const part of ['eyes', 'head']) {
    assert(presented[part].x > reference[part].x * 1.8, `${part}: input gain must remain visible after damping`);
    near(presented[part].y, -presented[part].x, `${part}: presentation must not invert the vertical response`);
  }
  for (let frame = 0; frame < fps * 3; frame += 1) {
    const rawX = frame % 7 < 3 ? 0.35 : -0.95;
    const rawY = Math.sin(frame * 0.7) * 1.4;
    stepGazeMotion(presented, mapGazeInput(rawX), mapGazeInput(rawY), 1 / fps);
    assertBounded(presented);
  }
  // Mouse leave / blur sends zero; prior velocity must not prevent recentering.
  for (let frame = 0; frame < fps; frame += 1) {
    stepGazeMotion(presented, mapGazeInput(0), mapGazeInput(0), 1 / fps);
    assertBounded(presented);
  }
  for (const part of ['eyes', 'head']) {
    near(presented[part].x, 0, `${fps} FPS ${part}: amplified reversals still return to center`, 1e-7);
    near(presented[part].y, 0, `${fps} FPS ${part}: vertical reversals still return to center`, 1e-7);
  }
}

console.log(JSON.stringify({
  status: 'passed', boundary: 'Native fitted dynamics plus presentation input behavior; GPU appearance requires separate browser checks',
  capturedFrames: samples.length, eyeTravel: end - start, fit,
  frameRates: [30, 60, 120], theoretical95Seconds: { eyes: GAZE_MOTION.eyes.response95Seconds, head: GAZE_MOTION.head.response95Seconds },
  presentation: GAZE_PRESENTATION, amplifiedSamples,
}, null, 2));
