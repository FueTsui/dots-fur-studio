/**
 * Critical-damping approximation fitted to a 65-frame native step response.
 * These are reconstruction parameters, not recovered native engine constants.
 * The fitting offsets account for pointer/render scheduling in the capture;
 * the interactive implementation intentionally adds no artificial input delay.
 */
export const GAZE_MOTION = Object.freeze({
  model: 'fitted-analytic-critical-damping',
  source: 'tests/fixtures/gaze-step-response.json',
  eyes: Object.freeze({
    angularFrequency: 52.5,
    captureSchedulingOffsetSeconds: 0.0186,
    response95Seconds: 4.743864518 / 52.5,
    measuredRmsFraction: 0.007223,
    measuredMaxFraction: 0.047288,
  }),
  head: Object.freeze({
    angularFrequency: 22.3,
    captureSchedulingOffsetSeconds: 0.0206,
    response95Seconds: 4.743864518 / 22.3,
    measuredRmsFraction: 0.003508,
    measuredMaxFraction: 0.023147,
  }),
});

function bounded(value) {
  return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
}

export function createGazeMotion(x = 0, y = 0) {
  return {
    eyes: { x: bounded(x), y: bounded(y), vx: 0, vy: 0 },
    head: { x: bounded(x), y: bounded(y), vx: 0, vy: 0 },
  };
}

function stepAxis(part, positionKey, velocityKey, target, dt, frequency) {
  const decay = Math.exp(-frequency * dt);
  // This also avoids infinity * zero when resuming after an extremely long gap.
  if (decay === 0) {
    part[positionKey] = target;
    part[velocityKey] = 0;
    return;
  }
  const error = part[positionKey] - target;
  const velocity = part[velocityKey];
  const rate = velocity + frequency * error;
  const position = target + (error + rate * dt) * decay;
  const nextVelocity = (velocity - frequency * rate * dt) * decay;
  part[positionKey] = bounded(position);
  part[velocityKey] = position === part[positionKey] ? nextVelocity : 0;
}

/**
 * Exact solution for a target held over dt: e'' + 2*w*e' + w*w*e = 0.
 * Carrying velocity between frames gives acceleration and settling separately
 * for eyes and head. A stationary step is monotone, without spring oscillation.
 */
export function stepGazeMotion(state, targetX, targetY, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  const x = bounded(targetX), y = bounded(targetY);
  for (const key of ['eyes', 'head']) {
    const frequency = GAZE_MOTION[key].angularFrequency;
    stepAxis(state[key], 'x', 'vx', x, dt, frequency);
    stepAxis(state[key], 'y', 'vy', y, dt, frequency);
  }
  return state;
}
