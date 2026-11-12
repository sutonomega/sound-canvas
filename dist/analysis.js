// Analysis is independent of AudioContext, playback, rendering and the DOM.
import { STEP_RATE } from './timing.js';
export const FEATURE_RATE = STEP_RATE;
export const ANALYSIS_VERSION = 'sc-analysis-2';
export const ANALYSIS_SETTINGS = Object.freeze({
  lowHz: 200, highHz: 2400, q: Math.SQRT1_2,
  normalizationFloor: 1e-4, silenceFloor: 1e-7,
  attackSeconds: .06, releaseSeconds: .25,
  beatAverageSeconds: .5, beatRatio: 1.5, beatFloor: .06,
  beatRise: .04, beatGapFrames: 6,
  intensityAttackSeconds: 1, intensityReleaseSeconds: 2.5,
});
const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
const check = signal => signal?.throwIfAborted();
const clamp = value => Math.max(0, Math.min(1, value));
const follow = (previous, target, dt, attack, release = attack) =>
  previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? attack : release)));

// Butterworth low/high-pass sections, normalized a0=1 (W3C Audio EQ Cookbook).
function filter(type, frequency, sampleRate) {
  const angle = 2 * Math.PI * Math.min(frequency, sampleRate * .45) / sampleRate;
  const cosine = Math.cos(angle), alpha = Math.sin(angle) / (2 * ANALYSIS_SETTINGS.q);
  const a0 = 1 + alpha;
  const b0 = (type === 'low' ? 1 - cosine : 1 + cosine) / (2 * a0);
  const b1 = (type === 'low' ? 1 - cosine : -(1 + cosine)) / a0;
  const a1 = -2 * cosine / a0, a2 = (1 - alpha) / a0;
  let z1 = 0, z2 = 0;
  return x => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b0 * x - a2 * y;
    return y;
  };
}

// Hash bounded PCM blocks, then their ordered digests and metadata. No second
// whole-song PCM copy is needed. The strong content key is separate from seed.
async function identify(channels, sampleRate, sampleCount, { signal, onProgress }) {
  const blockSize = 65536, digests = [];
  const total = channels.length * Math.ceil(sampleCount / blockSize);
  for (const channel of channels) {
    for (let start = 0; start < sampleCount; start += blockSize) {
      check(signal);
      const length = Math.min(blockSize, sampleCount - start);
      const bytes = new Uint8Array(channel.buffer, channel.byteOffset + start * 4, length * 4);
      digests.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
      check(signal);
      onProgress?.(`音源の識別情報を準備しています… ${Math.floor(digests.length / total * 100)}%`);
    }
  }
  const header = new TextEncoder().encode(JSON.stringify([
    ANALYSIS_VERSION, 'pcm-f32-block-sha256-v1', sampleRate, sampleCount, channels.length, blockSize,
  ]));
  const combined = new Uint8Array(header.length + digests.length * 32);
  combined.set(header);
  digests.forEach((digest, i) => combined.set(digest, header.length + i * 32));
  const result = await crypto.subtle.digest('SHA-256', combined);
  check(signal);
  return {
    trackKey: 'pcm-sha256-v1:' + Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join(''),
    seed: new DataView(result).getUint32(0, false),
  };
}

export async function analyzeAudio(buffer, { signal, onProgress, yieldTask = yieldToUI } = {}) {
  check(signal);
  const sampleRate = buffer.sampleRate, sampleCount = buffer.length;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(sampleCount)
      || sampleCount <= 0 || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels <= 0) {
    throw new Error('音源の長さ・サンプルレートを確認できませんでした。');
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  if (channels.some(channel => !(channel instanceof Float32Array) || channel.length !== sampleCount)) {
    throw new Error('音源のサンプルデータを読み取れませんでした。');
  }
  onProgress?.('音源の識別情報を準備しています… 0%');
  check(signal);
  const identity = await identify(channels, sampleRate, sampleCount, { signal, onProgress });
  const duration = sampleCount / sampleRate, count = Math.ceil(duration * FEATURE_RATE);
  if (!Number.isFinite(duration) || !Number.isSafeInteger(count)) {
    throw new Error('音源の解析区間を計算できませんでした。');
  }
  const s = ANALYSIS_SETTINGS;
  const filters = channels.map(() => ({
    low: filter('low', s.lowHz, sampleRate),
    midLow: filter('high', s.lowHz, sampleRate),
    midHigh: filter('low', s.highHz, sampleRate),
    high: filter('high', s.highHz, sampleRate),
  }));
  const frames = [];
  let peak = s.normalizationFloor;
  for (let frame = 0; frame < count; frame++) {
    const start = Math.floor(frame * sampleRate / FEATURE_RATE);
    const end = Math.min(sampleCount, Math.floor((frame + 1) * sampleRate / FEATURE_RATE));
    let total = 0, low = 0, mid = 0, high = 0;
    for (let channel = 0; channel < channels.length; channel++) {
      const samples = channels[channel], bank = filters[channel];
      for (let i = start; i < end; i++) {
        const x = Number.isFinite(samples[i]) ? samples[i] : 0;
        const l = bank.low(x), m = bank.midHigh(bank.midLow(x)), h = bank.high(x);
        total += x * x; low += l * l; mid += m * m; high += h * h;
      }
    }
    const denominator = Math.max(1, (end - start) * channels.length);
    const rms = energy => {
      const value = Math.sqrt(energy / denominator);
      return value < s.silenceFloor ? 0 : value;
    };
    const item = { volume: rms(total), bass: rms(low), mid: rms(mid), high: rms(high), beat: false, intensity: 0 };
    peak = Math.max(peak, item.volume);
    frames.push(item);
    if (frame % 120 === 0) {
      onProgress?.(`楽曲を解析しています… ${Math.floor(frame / count * 100)}%`);
      await yieldTask(); check(signal);
    }
  }

  const envelope = { volume: 0, bass: 0, mid: 0, high: 0 };
  let bassAverage = 0, previousBass = 0, lastBeat = -s.beatGapFrames, intensity = 0, density = 0;
  for (let frame = 0; frame < count; frame++) {
    const item = frames[frame];
    const dt = Math.min(1 / FEATURE_RATE, duration - frame / FEATURE_RATE);
    const rawBass = clamp(item.bass / peak), rawVolume = clamp(item.volume / peak);
    item.beat = rawVolume > s.beatFloor && rawBass > Math.max(s.beatFloor, bassAverage * s.beatRatio)
      && rawBass - previousBass > s.beatRise && frame - lastBeat >= s.beatGapFrames;
    if (item.beat) lastBeat = frame;
    bassAverage = follow(bassAverage, rawBass, dt, s.beatAverageSeconds);
    previousBass = rawBass;
    for (const key of ['volume', 'bass', 'mid', 'high']) {
      envelope[key] = follow(envelope[key], clamp(item[key] / peak), dt, s.attackSeconds, s.releaseSeconds);
      item[key] = clamp(envelope[key]);
    }
    density = follow(density, item.beat ? 1 : 0, dt, 1.5);
    const activity = clamp(item.bass + item.mid + item.high);
    const target = .7 * item.volume + .2 * activity + .1 * clamp(density * 15);
    intensity = follow(intensity, target, dt, s.intensityAttackSeconds, s.intensityReleaseSeconds);
    item.intensity = clamp(intensity);
    if (frame % 120 === 0) {
      onProgress?.(`解析値を整えています… ${Math.floor(frame / count * 100)}%`);
      await yieldTask(); check(signal);
    }
  }
  check(signal);
  onProgress?.('解析完了 100%');
  check(signal);
  return {
    version: ANALYSIS_VERSION, ...identity, sampleRate, sampleCount, duration,
    featureRate: FEATURE_RATE, frames,
  };
}
