export const STEP_RATE = 30;

export function frameCount(time, duration) {
  return time >= duration ? Math.ceil(duration * STEP_RATE) : Math.floor(Math.max(0, time) * STEP_RATE);
}

export function stepDuration(frame, duration = null) {
  return duration === null ? 1 / STEP_RATE : Math.max(0, Math.min(1 / STEP_RATE, duration - frame / STEP_RATE));
}
