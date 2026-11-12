import test from 'node:test';
import assert from 'node:assert/strict';
import { organicStyle } from '../dist/styles/organic.js';
import { analyzeAudio } from '../dist/analysis.js';
import { organicFixture, organicStress } from './organic-fixtures.js';

const input = { volume: .6, bass: .3, mid: .4, high: .1, intensity: .4, beat: false };
function fixture({ width = 720, height = 1280, strength = 1, capture = true } = {}) {
  const paths = [], details = [], glows = [], operations = [];
  const ctx = {
    beginPath() {}, moveTo(x, y) { this.start = [x, y]; },
    quadraticCurveTo(...args) { this.curve = args; },
    stroke() { if (capture) paths.push({ start: this.start, curve: this.curve,
      width: this.lineWidth, color: this.strokeStyle, composite: this.globalCompositeOperation }); },
    arc(...args) { if (capture) details.push(args); }, fill() {},
  };
  const effects = {
    createRadialGradient(...args) { if (capture) operations.push(args); return { addColorStop() {} }; },
    fillRect(...args) { if (capture) glows.push(args); },
  };
  const style = organicStyle.create();
  const settings = Object.freeze({ strength, theme: 'aurora', trail: 'accumulate' });
  style.reset({ width, height, seed: 12345, settings });
  const step = (features = input, frame = 0) => style.step({ frameIndex: frame, time: frame / 30,
    dt: 1 / 30, features: Object.freeze({ ...features }), layers: { drawing: ctx, effects } });
  return { style, step, paths, details, glows, operations };
}
function simulate(features, count = 180, options) {
  const result = fixture(options); for (let i = 0; i < count; i++) result.step(features, i); return result;
}
const distanceFromCenter = state => state.last.reduce((sum, [x, y]) => sum + Math.hypot((x - 360) / 720, (y - 640) / 1280), 0) / 7;

test('silence produces no new strokes, details or beat pulses even with other features present', () => {
  const r = simulate({ ...input, volume: 0, high: 1, intensity: 1, beat: true });
  assert.equal(r.paths.length, 0); assert.equal(r.details.length, 0); assert.equal(r.glows.length, 0);
});

test('higher volume produces thicker, brighter strokes without additive paint', () => {
  const quiet = simulate({ ...input, volume: .15 }), loud = simulate({ ...input, volume: .9 });
  assert.ok(loud.paths.at(-1).width > quiet.paths.at(-1).width * 2);
  assert.notEqual(loud.paths.at(-1).color, quiet.paths.at(-1).color);
  assert.ok(loud.paths.every(path => path.composite === 'source-over'));
});

test('bass expands the average curve position while preserving the music-driven clock', () => {
  const low = simulate({ ...input, bass: 0 }), strong = simulate({ ...input, bass: 1 });
  assert.equal(low.style.snapshot().travel, strong.style.snapshot().travel);
  assert.ok(distanceFromCenter(strong.style.snapshot()) > distanceFromCenter(low.style.snapshot()) * 1.3);
});

test('midrange changes travel speed and the actual curve path', () => {
  const low = simulate({ ...input, mid: 0 }), strong = simulate({ ...input, mid: 1 });
  assert.ok(strong.style.snapshot().travel > low.style.snapshot().travel * 1.5);
  assert.notDeepEqual(strong.style.snapshot().last, low.style.snapshot().last);
});

test('high-frequency energy adds small glints on the drawing layer', () => {
  const low = simulate({ ...input, high: 0 }), high = simulate({ ...input, high: 1 });
  assert.equal(low.details.length, 0); assert.ok(high.details.length > 20);
  assert.ok(high.details.every(([, , radius]) => radius < 2));
});

test('beat flashes are transient and stronger sections increase their count', () => {
  const quiet = fixture(), strong = fixture();
  quiet.step({ ...input, beat: true, intensity: 0 }); strong.step({ ...input, beat: true, intensity: 1 });
  assert.equal(quiet.style.snapshot().pulses.length, 2); assert.equal(strong.style.snapshot().pulses.length, 7);
  for (let i = 0; i < 30; i++) strong.step({ ...input, volume: 0 });
  assert.equal(strong.style.snapshot().pulses.length, 0);
});

test('intensity increases motion and fine-detail density without changing input volume', () => {
  const calm = simulate({ ...input, high: 1, intensity: 0 }), rise = simulate({ ...input, high: 1, intensity: 1 });
  assert.ok(rise.style.snapshot().travel > calm.style.snapshot().travel);
  assert.ok(rise.details.length > calm.details.length * 2);
});

test('response strength affects stroke width and motion', () => {
  const soft = simulate(input, 180, { strength: .25 }), strong = simulate(input, 180, { strength: 2 });
  assert.ok(strong.paths.at(-1).width > soft.paths.at(-1).width);
  assert.ok(strong.style.snapshot().travel > soft.style.snapshot().travel);
});

for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
  test(`${width}x${height}: maximum response keeps paths and glow bounds inside the canvas`, () => {
    const r = simulate({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }, 300, { width, height, strength: 2 });
    for (const path of r.paths) {
      for (const [x, y] of [path.start, path.curve.slice(0, 2), path.curve.slice(2)]) {
        assert.ok(x - path.width / 2 > 0 && x + path.width / 2 < width);
        assert.ok(y - path.width / 2 > 0 && y + path.width / 2 < height);
      }
    }
    for (const [x, y, w, h] of r.glows) assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
  });
}

test('snapshot restores motion phase, detail credit and the random emission sequence', () => {
  const r = fixture(); for (let i = 0; i < 55; i++) r.step(organicStress(i), i);
  const saved = r.style.snapshot();
  r.paths.length = 0; r.details.length = 0; r.operations.length = 0;
  for (let i = 55; i < 130; i++) r.step(organicStress(i), i);
  const expected = structuredClone({ paths: r.paths, details: r.details, operations: r.operations, state: r.style.snapshot() });
  r.style.restore(saved); r.paths.length = 0; r.details.length = 0; r.operations.length = 0;
  for (let i = 55; i < 130; i++) r.step(organicStress(i), i);
  assert.deepEqual({ paths: r.paths, details: r.details, operations: r.operations, state: r.style.snapshot() }, expected);
});

test('a ten-minute simulation keeps finite state and bounded transient data', () => {
  const r = fixture({ capture: false });
  for (let i = 0; i < 18000; i++) r.step(organicStress(i), i);
  const state = r.style.snapshot();
  assert.ok(state.pulses.length <= 64 && Number.isFinite(state.travel));
  assert.ok(state.detailCredit >= 0 && state.detailCredit < 1);
  assert.ok(state.last.flat().every(Number.isFinite));
});

test('invalid restored motion state is rejected without changing the current state', () => {
  const r = simulate(input), saved = r.style.snapshot();
  for (const patch of [{ travel: NaN }, { travel: -1 }, { detailCredit: 1 }, { detailCredit: -1 }]) {
    assert.throws(() => r.style.restore({ ...saved, ...patch }), /復元データ/);
    assert.deepEqual(r.style.snapshot(), saved);
  }
});

test('comparison fixture contains silent, calm and strong sections under one normalization', async () => {
  const analysis = await analyzeAudio(organicFixture(), { yieldTask: async () => {} });
  const frames = 18 * 30;
  const mean = (start, key) => analysis.frames.slice(start, start + frames).reduce((sum, f) => sum + f[key], 0) / frames;
  assert.equal(mean(0, 'volume'), 0);
  assert.ok(mean(frames * 2, 'volume') > mean(frames, 'volume') * 2);
  assert.ok(mean(frames * 2, 'intensity') > mean(frames, 'intensity') * 2);
  assert.ok(analysis.frames.slice(frames * 2).filter(frame => frame.beat).length >= 20);
});
