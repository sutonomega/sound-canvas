export const STEP_RATE = 30;
export const TICK_EPSILON = 1e-8;

// Snap only floating-point noise near an integer tick, not a measurable audio interval.
function ticks(time) {
  const value = time * STEP_RATE, nearest = Math.round(value);
  return Math.abs(value - nearest) <= Math.max(TICK_EPSILON, Number.EPSILON * Math.max(1, Math.abs(value)) * 4) ? nearest : value;
}

export function frameCount(time, duration) {
  return time >= duration ? Math.ceil(ticks(duration)) : Math.floor(ticks(Math.max(0, time)));
}

export function stepDuration(frame, duration = null) {
  return duration === null ? 1 / STEP_RATE : Math.max(0, Math.min(1 / STEP_RATE, duration - frame / STEP_RATE));
}
