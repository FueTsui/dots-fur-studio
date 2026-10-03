/** Presentation tuning layered over the measured native eye trajectories. */
export const GAZE_PRESENTATION = Object.freeze({
  inputGain: 2.1,
  headYaw: 0.085,
  headPitch: -0.055,
});

/** More response near the face, easing toward the same sampled endpoints. */
export function mapGazeInput(value) {
  const input = Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
  return Math.tanh(input * GAZE_PRESENTATION.inputGain) / Math.tanh(GAZE_PRESENTATION.inputGain);
}
