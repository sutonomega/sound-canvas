import test from 'node:test';
import assert from 'node:assert/strict';
import { geometricStyle } from '../dist/styles/geometric.js';
import { styleRegistry } from '../dist/styles/index.js';
import { organicStress } from './organic-fixtures.js';

const input = { volume: .6, bass: .3, mid: .4, high: .1, intensity: .4, beat: false };
function fixture({ width = 720, height = 1280, strength = 1, theme = 'aurora', capture = true } = {}) {
  const paths = [], arcs = [], effects = [];
  const ctx = {
    beginPath() {}, moveTo(x, y) { this.start = [x, y]; }, lineTo(x, y) { this.end = [x, y]; },
    stroke() { if (capture) paths.push({ start: this.start, end: this.end, width: this.lineWidth,
      color: this.strokeStyle, composite: this.globalCompositeOperation }); },
  };
  const e = {
    beginPath() {}, arc(...args) { if (capture) arcs.push(args); },
    stroke() { if (capture) effects.push(this.strokeStyle); }, fill() {},
  };
  const style = geometricStyle.create(), settings = Object.freeze({ strength, theme, trail: 'accumulate' });
  const reset = (seed = 12345) => style.reset({ width, height, settings, seed }); reset();
  const step = (features = input, frame = 0) => style.step({ frameIndex: frame, time: frame / 30,
    dt: 1 / 30, features: Object.freeze({ ...features }), layers: { drawing: ctx, effects: e } });
  return { style, step, reset, paths, arcs, effects };
}
function simulate(features, count = 180, options) {
  const result = fixture(options); for (let i = 0; i < count; i++) result.step(features, i); return result;
}

test('geometric style is independently registered with a complete common contract', () => {
  assert.equal(styleRegistry.geometric, geometricStyle);
  const a = geometricStyle.create(), b = geometricStyle.create(); assert.notEqual(a, b);
  for (const method of ['reset', 'step', 'snapshot', 'restore', 'dispose']) assert.equal(typeof a[method], 'function');
});

test('silence does not draw geometry, rings or flashes even when beat is set', () => {
  const r = simulate({ ...input, volume: 0, beat: true });
  assert.equal(r.paths.length, 0); assert.equal(r.arcs.length, 0);
  assert.equal(r.style.snapshot().rings.length, 0); assert.equal(r.style.snapshot().flash, 0);
});

test('bass smoothly expands the actual geometric radius', () => {
  const low = simulate({ ...input, bass: 0 }), strong = simulate({ ...input, bass: 1 });
  assert.ok(strong.style.snapshot().radius > low.style.snapshot().radius * 1.5);
  assert.notDeepEqual(strong.style.snapshot().last, low.style.snapshot().last);
});

test('beat produces a ring, flash and a rotation change without an instantaneous phase jump', () => {
  const steady = fixture(), beat = fixture(); steady.step(input); beat.step({ ...input, beat: true });
  assert.equal(beat.style.snapshot().rings.length, 1); assert.equal(beat.style.snapshot().flash, 1);
  const difference = beat.style.snapshot().rotation - steady.style.snapshot().rotation;
  assert.ok(difference > 0 && difference < .03);
});

test('midrange and intensity increase angular motion', () => {
  const low = simulate({ ...input, mid: 0, intensity: 0 }, 30);
  const strong = simulate({ ...input, mid: 1, intensity: 1 }, 30);
  assert.ok(strong.style.snapshot().angles[0] > low.style.snapshot().angles[0] + .5);
});

test('high frequencies change the shape while keeping the angle clock unchanged', () => {
  const low = simulate({ ...input, high: 0 }), high = simulate({ ...input, high: 1 });
  assert.deepEqual(low.style.snapshot().angles, high.style.snapshot().angles);
  assert.notDeepEqual(low.style.snapshot().last, high.style.snapshot().last);
});

test('volume and response change line width and color using non-additive paint', () => {
  const quiet = simulate({ ...input, volume: .1 }, 30), loud = simulate({ ...input, volume: 1 }, 30, { strength: 2 });
  assert.ok(loud.paths.at(-1).width > quiet.paths.at(-1).width * 2);
  assert.notEqual(loud.paths.at(-1).color, quiet.paths.at(-1).color);
  assert.ok(loud.paths.every(path => path.composite === 'source-over'));
});

test('all three themes change color without changing the same-seed geometry', () => {
  const a = simulate(input, 90, { theme: 'aurora' }), b = simulate(input, 90, { theme: 'ember' }), c = simulate(input, 90, { theme: 'ocean' });
  assert.deepEqual(a.style.snapshot().last, b.style.snapshot().last); assert.deepEqual(b.style.snapshot().last, c.style.snapshot().last);
  assert.notEqual(a.paths.at(-1).color, b.paths.at(-1).color); assert.notEqual(b.paths.at(-1).color, c.paths.at(-1).color);
});

for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
  test(`${width}x${height}: strokes and beat circles stay inside at maximum response`, () => {
    const r = simulate({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }, 300, { width, height, strength: 2 });
    for (const path of r.paths) for (const [x, y] of [path.start, path.end]) {
      assert.ok(x - path.width / 2 > 0 && x + path.width / 2 < width);
      assert.ok(y - path.width / 2 > 0 && y + path.width / 2 < height);
    }
    for (const [x, y, radius] of r.arcs) assert.ok(x - radius > 0 && y - radius > 0 && x + radius < width && y + radius < height);
  });
}

test('snapshot and restore reproduce angles, radius, rotation, effects and random sequence', () => {
  const r = fixture(); for (let i = 0; i < 65; i++) r.step(organicStress(i), i);
  const saved = r.style.snapshot(); r.paths.length = 0; r.arcs.length = 0; r.effects.length = 0;
  for (let i = 65; i < 180; i++) r.step(organicStress(i), i);
  const expected = structuredClone({ paths: r.paths, arcs: r.arcs, effects: r.effects, state: r.style.snapshot() });
  r.style.restore(saved); r.paths.length = 0; r.arcs.length = 0; r.effects.length = 0;
  for (let i = 65; i < 180; i++) r.step(organicStress(i), i);
  assert.deepEqual({ paths: r.paths, arcs: r.arcs, effects: r.effects, state: r.style.snapshot() }, expected);
});

test('repeated reset is deterministic and different seeds change the pattern', () => {
  const r = fixture(); for (let i = 0; i < 90; i++) r.step(input, i); const expected = r.style.snapshot();
  r.reset(); for (let i = 0; i < 90; i++) r.step(input, i); assert.deepEqual(r.style.snapshot(), expected);
  r.reset(54321); for (let i = 0; i < 90; i++) r.step(input, i); assert.notDeepEqual(r.style.snapshot().last, expected.last);
});

test('rapid repeated beats stay bounded and silence clears all transient effects', () => {
  const r = fixture({ capture: false }); for (let i = 0; i < 600; i++) r.step({ ...input, beat: true }, i);
  assert.ok(r.style.snapshot().rings.length <= 24);
  for (let i = 0; i < 120; i++) r.step({ ...input, volume: 0, beat: false }, i);
  assert.equal(r.style.snapshot().rings.length, 0); assert.equal(r.style.snapshot().flash, 0);
});

test('angle wrapping does not introduce long jumps between adjacent points', () => {
  const r = simulate({ ...input, mid: 1, intensity: 1, beat: true }, 2000, { strength: 2 });
  assert.ok(r.paths.every(path => Math.hypot(path.end[0] - path.start[0], path.end[1] - path.start[1]) < 72));
});

test('ten-minute simulation keeps finite bounded state', () => {
  const r = fixture({ capture: false }); for (let i = 0; i < 18000; i++) r.step(organicStress(i), i);
  const state = r.style.snapshot(); assert.ok(state.angles.every(x => x >= 0 && x < Math.PI * 2));
  assert.ok(Number.isFinite(state.radius) && state.rings.length <= 24 && state.last.flat().every(Number.isFinite));
});

test('invalid restore data cannot overwrite active geometry', () => {
  const r = simulate(input), state = r.style.snapshot();
  for (const patch of [{ angles: [] }, { radius: NaN }, { rotation: -1 }, { flash: 2 }, { rings: [{ age: 1 }] }]) {
    assert.throws(() => r.style.restore({ ...state, ...patch }), /復元データ/); assert.deepEqual(r.style.snapshot(), state);
  }
});
