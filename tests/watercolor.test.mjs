import test from 'node:test';
import assert from 'node:assert/strict';
import { watercolorStyle, WATERCOLOR_BLOOM_LIMIT } from '../dist/styles/watercolor.js';
import { styleRegistry } from '../dist/styles/index.js';
import { organicStress } from './organic-fixtures.js';
const input = { volume: .6, bass: .3, mid: .4, high: .1, intensity: .4, beat: false };
const silence = { volume: 0, bass: 0, mid: 0, high: 0, intensity: 0, beat: false };
function fixture({ width = 720, height = 1280, strength = 1, theme = 'aurora', capture = true } = {}) {
  const washes = [], speckles = [], effects = [];
  const context = target => ({
    createRadialGradient(...args) {
      const gradient = { args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
      return gradient;
    },
    beginPath() { this.points = []; this.circle = null; },
    moveTo(x, y) { this.points.push([x, y]); }, lineTo(x, y) { this.points.push([x, y]); }, closePath() {},
    arc(...args) { this.circle = args; },
    fill() {
      if (!capture) return;
      const item = { points: this.points, circle: this.circle, paint: typeof this.fillStyle === 'string' ? this.fillStyle : { args: this.fillStyle.args, stops: this.fillStyle.stops }, composite: this.globalCompositeOperation };
      if (target === effects) effects.push(item); else if (this.circle) speckles.push(item); else washes.push(item);
    },
  });
  const drawing = context(washes), effect = context(effects), style = watercolorStyle.create();
  const settings = Object.freeze({ strength, theme, trail: 'accumulate' });
  const reset = (seed = 12345) => style.reset({ width, height, settings, seed }); reset();
  const step = (features = input, frame = 0, dt = 1 / 30) => style.step({ frameIndex: frame, time: frame / 30, dt,
    features: Object.freeze({ ...features }), layers: { drawing, effects: effect } });
  return { style, reset, step, washes, speckles, effects };
}
function simulate(features = input, count = 180, options) {
  const r = fixture(options); for (let i = 0; i < count; i++) r.step(features, i); return r;
}
test('watercolor is registered with independent instances and complete contract', () => {
  assert.equal(styleRegistry.watercolor, watercolorStyle); assert.notEqual(watercolorStyle.create(), watercolorStyle.create());
  for (const method of ['reset', 'step', 'snapshot', 'restore', 'dispose']) assert.equal(typeof watercolorStyle.create()[method], 'function');
});
test('initial silence draws no pigment or beat blooms', () => {
  const r = simulate({ ...silence, beat: true });
  assert.equal(r.washes.length + r.effects.length + r.speckles.length, 0); assert.equal(r.style.snapshot().blooms.length, 0);
});
test('bass expands the actual pigment radius and distribution', () => {
  const low = simulate({ ...input, bass: 0 }), high = simulate({ ...input, bass: 1 });
  assert.ok(high.washes[0].paint.args[5] > low.washes[0].paint.args[5] * 2);
  assert.notDeepEqual(high.washes[0].paint.args.slice(0, 2), low.washes[0].paint.args.slice(0, 2));
});
test('high frequencies add fine pigment speckles', () => {
  const low = simulate({ ...input, high: 0 }), high = simulate({ ...input, high: 1 });
  assert.equal(low.speckles.length, 0); assert.ok(high.speckles.length >= high.washes.length * 6);
  assert.ok(high.speckles.every(item => item.circle[2] < high.washes[0].paint.args[5] * .1));
});
test('midrange changes flow without changing stamp rate', () => {
  const low = simulate({ ...input, mid: 0 }), high = simulate({ ...input, mid: 1 });
  assert.equal(low.washes.length, high.washes.length); assert.ok(high.style.snapshot().clock > low.style.snapshot().clock);
  assert.notDeepEqual(low.washes.at(-1).points, high.washes.at(-1).points);
});
test('intensity increases pigment density and flow', () => {
  const low = simulate({ ...input, intensity: 0 }), high = simulate({ ...input, intensity: 1 });
  assert.ok(high.washes.length > low.washes.length * 1.8); assert.ok(high.style.snapshot().clock > low.style.snapshot().clock);
});
test('volume changes pigment opacity with non-additive saturated color', () => {
  const low = simulate({ ...input, volume: .05 }), high = simulate({ ...input, volume: 1 });
  const alpha = r => Number(r.washes[0].paint.stops[1][1].split(',').at(-1).slice(0, -1));
  assert.ok(alpha(high) > alpha(low));
  assert.ok(high.washes.every(w => w.composite === 'source-over' && w.paint.stops[1][1].includes('82%,56%')));
});
test('response setting changes radius, density and motion', () => {
  const low = simulate(input, 180, { strength: .25 }), high = simulate(input, 180, { strength: 2 });
  assert.ok(high.washes.length > low.washes.length); assert.ok(high.washes[0].paint.args[5] > low.washes[0].paint.args[5]);
  assert.ok(high.style.snapshot().clock > low.style.snapshot().clock);
});
test('beat creates a bounded expanding bloom that expires during silence', () => {
  const r = fixture(); r.step({ ...input, beat: true }); assert.equal(r.style.snapshot().blooms.length, 1);
  const radius = r.effects.at(-1).paint.args[5]; r.effects.length = 0; r.step(silence);
  assert.ok(r.effects.at(-1).paint.args[5] > radius);
  const random = r.style.snapshot().randomState, credit = r.style.snapshot().stampCredit;
  for (let i = 0; i < 60; i++) r.step(silence);
  assert.equal(r.style.snapshot().blooms.length, 0); assert.equal(r.style.snapshot().randomState, random);
  assert.equal(r.style.snapshot().stampCredit, credit);
});
test('continuous beat cannot exceed the transient limit', () => {
  const r = simulate({ ...input, beat: true }, 900, { capture: false });
  assert.equal(r.style.snapshot().blooms.length, WATERCOLOR_BLOOM_LIMIT);
});
test('themes change pigment colors without changing wash geometry', () => {
  const results = ['aurora', 'ember', 'ocean'].map(theme => simulate(input, 90, { theme }));
  assert.deepEqual(results[0].washes.map(w => w.points), results[1].washes.map(w => w.points));
  assert.deepEqual(results[1].washes.map(w => w.points), results[2].washes.map(w => w.points));
  assert.notDeepEqual(results[0].washes[0].paint.stops, results[1].washes[0].paint.stops);
  assert.notDeepEqual(results[1].washes[0].paint.stops, results[2].washes[0].paint.stops);
});
for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
  test(`${width}x${height}: full response wash, speckle and bloom bounds leave a margin`, () => {
    const r = simulate({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }, 300, { width, height, strength: 2 });
    const margin = Math.min(width, height) * .02;
    for (const w of [...r.washes, ...r.effects]) for (const [x, y] of w.points) {
      assert.ok(x > margin && y > margin && x < width - margin && y < height - margin);
    }
    for (const w of r.speckles) {
      const [x, y, radius] = w.circle;
      assert.ok(x - radius > margin && y - radius > margin && x + radius < width - margin && y + radius < height - margin);
    }
  });
}
test('snapshot restores future pigment, bloom, random sequence and fractional emission', () => {
  const r = fixture(); for (let i = 0; i < 67; i++) r.step(organicStress(i), i);
  const saved = r.style.snapshot(); assert.ok(saved.stampCredit > 0 && saved.stampCredit < 1);
  const clear = () => { r.washes.length = r.speckles.length = r.effects.length = 0; }; clear();
  for (let i = 67; i < 200; i++) r.step(organicStress(i), i);
  const expected = structuredClone({ washes: r.washes, speckles: r.speckles, effects: r.effects, state: r.style.snapshot() });
  r.style.restore(saved); clear(); for (let i = 67; i < 200; i++) r.step(organicStress(i), i);
  assert.deepEqual({ washes: r.washes, speckles: r.speckles, effects: r.effects, state: r.style.snapshot() }, expected);
});
test('reset recreates same seed and a different seed changes the painting', () => {
  const r = simulate(); const expected = structuredClone(r.washes); r.reset(); r.washes.length = 0;
  for (let i = 0; i < 180; i++) r.step(input, i); assert.deepEqual(r.washes, expected);
  r.reset(45678); r.washes.length = 0; for (let i = 0; i < 180; i++) r.step(input, i); assert.notDeepEqual(r.washes, expected);
});
test('ten minutes of simulation keep finite bounded state', () => {
  const r = fixture({ capture: false, strength: 2 });
  for (let i = 0; i < 18000; i++) {
    r.step(organicStress(i), i); const state = r.style.snapshot();
    assert.ok(state.blooms.length <= WATERCOLOR_BLOOM_LIMIT); assert.ok(Number.isFinite(state.clock));
    assert.ok(state.stampCredit >= 0 && state.stampCredit < 1);
    if (i % 300 === 0) r.style.restore(state);
  }
});
test('invalid restore is rejected without changing existing state', () => {
  const r = simulate({ ...input, beat: true }, 30); const saved = r.style.snapshot();
  const changes = [s => s.clock = NaN, s => s.stampCredit = 1, s => s.randomState = -1,
    s => s.blooms.push(...Array(20).fill(s.blooms[0])), s => s.blooms[0].x = -1,
    s => s.blooms[0].age = s.blooms[0].life, s => s.blooms[0].radius = Infinity,
    s => s.blooms[0].hue = 360, s => s.blooms[0].energy = 2];
  for (const change of changes) { const bad = structuredClone(saved); change(bad); assert.throws(() => r.style.restore(bad)); assert.deepEqual(r.style.snapshot(), saved); }
});
test('short final timestep advances proportionally and silence does not accumulate stamps', () => {
  const full = fixture(), short = fixture(); full.step(input); short.step(input, 0, 1 / 300);
  assert.ok(Math.abs(full.style.snapshot().clock / short.style.snapshot().clock - 10) < 1e-10);
  const state = short.style.snapshot(); for (let i = 0; i < 30; i++) short.step(silence);
  assert.equal(short.style.snapshot().stampCredit, state.stampCredit);
});
test('dispose releases all transient blooms', () => {
  const r = simulate({ ...input, beat: true }); assert.ok(r.style.snapshot().blooms.length > 0);
  r.style.dispose(); assert.deepEqual(r.style.snapshot().blooms, []);
});
