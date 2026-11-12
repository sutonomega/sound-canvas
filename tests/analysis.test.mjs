import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, ANALYSIS_VERSION, ANALYSIS_SETTINGS } from '../dist/analysis.js';
import { AudioEngine } from '../dist/audio.js';
import { frameCount } from '../dist/timing.js';

const options = { yieldTask: async () => {} };
function pcm({ seconds = 2, sampleRate = 48000, channels = 1, sample = () => 0, length } = {}) {
  length ??= Math.round(seconds * sampleRate);
  const data = Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length }, (_, i) => sample(i / sampleRate, channel, i)));
  return { sampleRate, length, numberOfChannels: channels, duration: length / sampleRate,
    getChannelData: channel => data[channel] };
}
const tone = (hz, amplitude = .5) => time => amplitude * Math.sin(2 * Math.PI * hz * time);
const mean = (frames, key) => frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length;
function valid(analysis) {
  assert.equal(analysis.version, ANALYSIS_VERSION);
  assert.equal(analysis.featureRate, 30);
  assert.equal(analysis.frames.length, frameCount(analysis.duration, analysis.duration));
  for (const frame of analysis.frames) {
    assert.equal(typeof frame.beat, 'boolean');
    for (const key of ['volume', 'bass', 'mid', 'high', 'intensity']) {
      assert.ok(Number.isFinite(frame[key]) && frame[key] >= 0 && frame[key] <= 1, `${key}: ${frame[key]}`);
    }
  }
}

for (const [hz, target] of [[60, 'bass'], [1000, 'mid'], [8000, 'high']]) {
  test(`${hz} Hz is strongest in ${target} after settling`, async () => {
    const analysis = await analyzeAudio(pcm({ sample: tone(hz) }), options);
    valid(analysis);
    const settled = analysis.frames.slice(30);
    for (const other of ['bass', 'mid', 'high'].filter(key => key !== target)) {
      assert.ok(mean(settled, target) > mean(settled, other) * 5, `${target} must dominate ${other}`);
    }
  });
}

test('silence has zero features, no beats and no intensity', async () => {
  const analysis = await analyzeAudio(pcm(), options); valid(analysis);
  for (const frame of analysis.frames) {
    assert.deepEqual(frame, { volume: 0, bass: 0, mid: 0, high: 0, beat: false, intensity: 0 });
  }
});

test('anti-phase stereo keeps the same energy as mono', async () => {
  const mono = await analyzeAudio(pcm({ sample: tone(100) }), options);
  const stereo = await analyzeAudio(pcm({ channels: 2,
    sample: (time, channel) => tone(100)(time) * (channel === 0 ? 1 : -1) }), options);
  valid(stereo);
  for (let i = 0; i < mono.frames.length; i++) {
    for (const key of ['volume', 'bass', 'mid', 'high', 'intensity']) {
      assert.ok(Math.abs(stereo.frames[i][key] - mono.frames[i][key]) < 1e-10);
    }
    assert.equal(stereo.frames[i].beat, mono.frames[i].beat);
  }
  assert.notEqual(stereo.trackKey, mono.trackKey); // Channel layout is content metadata.
});

test('a single silent channel reduces energy equally across bands without cancelling the other', async () => {
  const mono = await analyzeAudio(pcm({ sample: tone(1000) }), options);
  const stereo = await analyzeAudio(pcm({ channels: 2,
    sample: (time, channel) => channel === 0 ? tone(1000)(time) : 0 }), options);
  assert.ok(mean(stereo.frames.slice(30), 'mid') > .9);
  for (let i = 0; i < mono.frames.length; i++) {
    assert.ok(Math.abs(mono.frames[i].mid - stereo.frames[i].mid) < 1e-10);
  }
});

test('global gain changes preserve normalized musical dynamics above the noise floor', async () => {
  const sample = time => (.3 + .2 * Math.sin(time * 4)) * Math.sin(2 * Math.PI * 100 * time);
  const loud = await analyzeAudio(pcm({ sample }), options);
  const quiet = await analyzeAudio(pcm({ sample: time => sample(time) * .1 }), options);
  for (let i = 0; i < loud.frames.length; i++) {
    for (const key of ['volume', 'bass', 'mid', 'high', 'intensity']) {
      assert.ok(Math.abs(loud.frames[i][key] - quiet.frames[i][key]) < 1e-6);
    }
    assert.equal(loud.frames[i].beat, quiet.frames[i].beat);
  }
});

test('an abrupt rise and release are smoothed instead of changing in one frame', async () => {
  const analysis = await analyzeAudio(pcm({ seconds: 4,
    sample: time => time >= 1 && time < 2 ? tone(1000)(time) : 0 }), options);
  const frames = analysis.frames;
  assert.equal(frames[29].volume, 0);
  assert.ok(frames[30].volume > 0 && frames[30].volume < .6);
  assert.ok(frames[31].volume > frames[30].volume);
  assert.ok(frames[60].volume > 0 && frames[60].volume < frames[59].volume);
  assert.ok(frames[90].volume < .03);
});

test('sustained bass does not produce a beat on every strong frame', async () => {
  const analysis = await analyzeAudio(pcm({ seconds: 4, sample: tone(80) }), options);
  const beats = analysis.frames.map((frame, i) => frame.beat ? i : -1).filter(i => i >= 0);
  assert.ok(beats.length >= 1 && beats.length <= 2, `unexpected sustained beat count ${beats.length}`);
  assert.equal(analysis.frames.slice(30).filter(frame => frame.beat).length, 0);
});

test('bass pulses produce isolated beats with at least 200 ms spacing', async () => {
  const analysis = await analyzeAudio(pcm({ seconds: 4,
    sample: time => tone(80)(time) * Math.exp(-(time % .5) * 22) }), options);
  const beats = analysis.frames.map((frame, i) => frame.beat ? i : -1).filter(i => i >= 0);
  assert.ok(beats.length >= 6 && beats.length <= 8, `pulse count ${beats.length}`);
  beats.slice(1).forEach((frame, i) => assert.ok(frame - beats[i] >= ANALYSIS_SETTINGS.beatGapFrames));
});

test('rapid pulses still respect the refractory interval', async () => {
  const analysis = await analyzeAudio(pcm({ seconds: 2,
    sample: time => tone(80)(time) * Math.exp(-(time % .1) * 80) }), options);
  const beats = analysis.frames.map((frame, i) => frame.beat ? i : -1).filter(i => i >= 0);
  assert.ok(beats.length > 0);
  beats.slice(1).forEach((frame, i) => assert.ok(frame - beats[i] >= 6));
});

test('intensity follows a stronger section slowly and remains bounded', async () => {
  const analysis = await analyzeAudio(pcm({ seconds: 8,
    sample: time => tone(1000, time < 4 ? .025 : .5)(time) }), options);
  valid(analysis);
  assert.ok(mean(analysis.frames.slice(210), 'intensity') > mean(analysis.frames.slice(60, 110), 'intensity') + .5);
  assert.ok(analysis.frames[120].intensity < analysis.frames[180].intensity);
  assert.ok(analysis.frames[120].intensity - analysis.frames[119].intensity < .03);
});

test('reanalysis of identical PCM is deterministic, including seed and content identity', async () => {
  const input = pcm({ sample: tone(440) });
  const a = await analyzeAudio(input, options), b = await analyzeAudio(input, options);
  assert.deepEqual(a, b);
  assert.match(a.trackKey, /^pcm-sha256-v1:[0-9a-f]{64}$/);
});

test('a change between old sparse seed samples changes content identity', async () => {
  const input = pcm({ length: 1000 });
  const a = await analyzeAudio(input, options);
  input.getChannelData(0)[53] = .01;
  const b = await analyzeAudio(input, options);
  assert.notEqual(a.trackKey, b.trackKey); assert.notEqual(a.seed, b.seed);
});

test('sample rate is part of content identity', async () => {
  const a = await analyzeAudio(pcm({ length: 1000, sampleRate: 8000, sample: tone(200) }), options);
  const buffer = pcm({ length: 1000, sampleRate: 8000, sample: tone(200) });
  buffer.sampleRate = 16000;
  const b = await analyzeAudio(buffer, options);
  assert.notEqual(a.trackKey, b.trackKey);
});

test('the final partial interval includes the last sample', async () => {
  const analysis = await analyzeAudio(pcm({ sampleRate: 8000, length: 901,
    sample: (_, __, i) => i === 900 ? .5 : 0 }), options);
  valid(analysis); assert.equal(analysis.frames.length, 4);
  assert.equal(analysis.frames[2].volume, 0); assert.ok(analysis.frames[3].volume > 0);
});

test('nonfinite samples and sub-noise-floor input cannot produce nonfinite features or beats', async () => {
  const input = pcm({ sample: (_, __, i) => [NaN, Infinity, -Infinity, 1e-10][i % 4] });
  const analysis = await analyzeAudio(input, options); valid(analysis);
  assert.ok(analysis.frames.every(frame => frame.volume === 0 && !frame.beat && frame.intensity === 0));
});

test('more than 150,000 frames normalize without argument-spread limits', async () => {
  // Reduced-rate synthetic PCM tests feature-array scale, not real media throughput.
  const progress = [];
  const analysis = await analyzeAudio(pcm({ sampleRate: 30, length: 150001 }),
    { ...options, onProgress: text => progress.push(text) });
  valid(analysis); assert.equal(analysis.frames.length, 150001);
  assert.equal(progress.at(-1), '解析完了 100%');
});

test('cancellation in the normalization pass returns no partial analysis', async () => {
  const abort = new AbortController();
  await assert.rejects(analyzeAudio(pcm(), { ...options, signal: abort.signal, onProgress: text => {
    if (text.startsWith('解析値を整えています')) abort.abort();
  } }), { name: 'AbortError' });
});

test('invalid buffer metadata fails with a readable error', async () => {
  await assert.rejects(analyzeAudio(pcm({ length: 0 }), options), /音源の長さ/);
  await assert.rejects(analyzeAudio({ ...pcm(), sampleRate: NaN }, options), /サンプルレート/);
});

test('content identification includes a partial block after the 65,536-sample boundary', async () => {
  const input = pcm({ length: 65537 });
  const before = await analyzeAudio(input, options);
  input.getChannelData(0)[65536] = .1;
  const after = await analyzeAudio(input, options);
  assert.notEqual(before.trackKey, after.trackKey);
});

test('cancellation after hashing cannot return an analysis', async () => {
  const abort = new AbortController();
  await assert.rejects(analyzeAudio(pcm({ length: 1000 }), {
    ...options, signal: abort.signal, onProgress: text => {
      if (text.startsWith('音源の識別情報') && text.endsWith('100%')) abort.abort();
    },
  }), { name: 'AbortError' });
});

test('AudioEngine commits the shared analysis once and reuses its feature objects', async () => {
  const engine = new AudioEngine(), input = pcm({ sample: tone(440) });
  const candidate = await engine.analyze(input, options);
  assert.equal(engine.buffer, null);
  engine.commit(candidate);
  assert.equal(engine.analysis, candidate.analysis);
  assert.equal(engine.features, candidate.analysis.frames);
  engine.setPosition(1);
  assert.equal(engine.feature(30), candidate.analysis.frames[30]);
});

test('analysis and rendering agree at a floating-point aligned end without an empty frame', async () => {
  for (const sampleRate of [44100, 48000]) {
    const buffer = pcm({ sampleRate, length: sampleRate / 30 * 31, sample: tone(1000) });
    const analysis = await analyzeAudio(buffer, options);
    assert.equal(analysis.frames.length, 31); assert.equal(frameCount(buffer.duration, buffer.duration), 31);
    assert.ok(analysis.frames.at(-1).volume > 0);
  }
});
test('one final audio sample beyond a tick remains a real partial frame', async () => {
  const buffer = pcm({ sampleRate: 48000, length: 1600 * 31 + 1, sample: tone(500) });
  const analysis = await analyzeAudio(buffer, options);
  assert.equal(analysis.frames.length, 32); assert.equal(frameCount(buffer.duration, buffer.duration), 32);
  assert.ok(Number.isFinite(analysis.frames.at(-1).volume));
});
