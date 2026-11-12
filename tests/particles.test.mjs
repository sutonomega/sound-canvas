import test from 'node:test';
import assert from 'node:assert/strict';
import { particleStyle, PARTICLE_LIMIT, PARTICLE_GLOW_LIMIT } from '../dist/styles/particles.js';
import { styleRegistry } from '../dist/styles/index.js';
import { palettes } from '../dist/themes.js';
import { organicStress } from './organic-fixtures.js';

const input = { volume: .6, bass: .3, mid: .4, high: .1, intensity: .4, beat: false };
function fixture({ width = 720, height = 1280, strength = 1, theme = 'aurora', capture = true } = {}) {
  const paths = [], arcs = [], glows = []; let glowCalls = 0;
  const c = {
    beginPath() {}, moveTo(x, y) { this.start = [x, y]; }, lineTo(x, y) { this.end = [x, y]; },
    stroke() { if (capture) paths.push({ start: this.start, end: this.end, width: this.lineWidth,
      color: this.strokeStyle, composite: this.globalCompositeOperation }); },
  };
  const e = {
    beginPath() {}, arc(...args) { if (capture) arcs.push(args); }, fill() {},
    createRadialGradient(...args) { glowCalls++; if (capture) glows.push(args); return { addColorStop() {} }; }, fillRect() {},
  };
  const style = particleStyle.create(), settings = Object.freeze({ strength, theme, trail: 'accumulate' });
  const reset = (seed = 12345) => style.reset({ width, height, settings, seed }); reset();
  const step = (features = input, frame = 0) => style.step({ frameIndex: frame, time: frame / 30,
    dt: 1 / 30, features: Object.freeze({ ...features }), layers: { drawing: c, effects: e } });
  return { style, reset, step, paths, arcs, glows, glowCalls: () => glowCalls };
}
function simulate(features, count = 90, options) {
  const r = fixture(options); for (let i = 0; i < count; i++) r.step(features, i); return r;
}
const mean = (items, value) => items.reduce((sum, item) => sum + value(item), 0) / items.length;

test('particle style registers an independent instance and an explicit transient limit', () => {
  assert.equal(styleRegistry.particles, particleStyle); assert.equal(particleStyle.maxTransient, PARTICLE_LIMIT);
  assert.notEqual(particleStyle.create(), particleStyle.create());
});

test('initial silence emits no particles or drawing even when other features and beat are present', () => {
  const r = simulate({ ...input, volume: 0, high: 1, intensity: 1, beat: true });
  assert.equal(r.style.snapshot().particles.length, 0); assert.equal(r.paths.length, 0); assert.equal(r.glowCalls(), 0);
});

test('high frequencies emit more and finer particles', () => {
  const low = simulate({ ...input, high: 0 }), high = simulate({ ...input, high: 1 });
  const a = low.style.snapshot().particles, b = high.style.snapshot().particles;
  assert.ok(b.length > a.length * 2); assert.ok(mean(b, p => p.radius) < mean(a, p => p.radius) * .6);
});

test('bass increases outward speed and initial spread', () => {
  const low = fixture(), high = fixture();
  low.step({ ...input, bass: 0, beat: true }); high.step({ ...input, bass: 1, beat: true });
  const a = low.style.snapshot().particles, b = high.style.snapshot().particles;
  assert.equal(a.length, b.length);
  assert.ok(mean(b, p => Math.hypot(p.vx, p.vy)) > mean(a, p => Math.hypot(p.vx, p.vy)) * 3);
  assert.ok(mean(b, p => Math.hypot(p.x - 360, p.y - 640)) > mean(a, p => Math.hypot(p.x - 360, p.y - 640)) * 1.4);
});

test('midrange changes the flow of existing particles without needing new emission', () => {
  const low = fixture(), high = fixture(); low.step({ ...input, beat: true }); high.style.restore(low.style.snapshot());
  for (let i = 0; i < 20; i++) { low.step({ ...input, volume: 0, mid: 0 }); high.step({ ...input, volume: 0, mid: 1 }); }
  const a = low.style.snapshot().particles, b = high.style.snapshot().particles;
  assert.equal(a.length, b.length); assert.notDeepEqual(a.map(p => [p.x, p.y]), b.map(p => [p.x, p.y]));
});

test('intensity increases density and motion', () => {
  const calm = simulate({ ...input, intensity: 0 }), strong = simulate({ ...input, intensity: 1 });
  assert.ok(strong.style.snapshot().particles.length > calm.style.snapshot().particles.length * 2);
  assert.ok(strong.style.snapshot().clock > calm.style.snapshot().clock);
});

test('beat emits a bounded extra burst', () => {
  const regular = fixture(), beat = fixture(); regular.step(input); beat.step({ ...input, beat: true });
  assert.equal(beat.style.snapshot().particles.length - regular.style.snapshot().particles.length, 6);
});

test('volume affects persistent trail width and color without additive blending', () => {
  const quiet = fixture(), loud = fixture(); quiet.step({ ...input, volume: .1, beat: true }); loud.step({ ...input, volume: 1, beat: true });
  assert.ok(loud.paths[0].width > quiet.paths[0].width); assert.notEqual(loud.paths[0].color, quiet.paths[0].color);
  assert.ok(loud.paths.every(path => path.composite === 'source-over'));
});

test('response strength increases emission and energy', () => {
  const soft = simulate(input, 90, { strength: .25 }), strong = simulate(input, 90, { strength: 2 });
  assert.ok(strong.style.snapshot().particles.length > soft.style.snapshot().particles.length * 2);
  assert.ok(strong.style.snapshot().particles[0].energy > soft.style.snapshot().particles[0].energy);
});

test('all themes change particle colors while preserving the same simulation', () => {
  const snapshots = ['aurora', 'ember', 'ocean'].map(theme => {
    const state = simulate(input, 90, { theme }).style.snapshot();
    assert.ok(state.particles.every(p => palettes[theme].includes(p.hue))); return state;
  });
  const neutral = state => ({ ...state, particles: state.particles.map(p => ({ ...p, hue: 0 })) });
  assert.deepEqual(neutral(snapshots[0]), neutral(snapshots[1])); assert.deepEqual(neutral(snapshots[1]), neutral(snapshots[2]));
  assert.notEqual(snapshots[0].particles[0].hue, snapshots[1].particles[0].hue);
});

for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
  test(`${width}x${height}: trails, particle cores and glows stay inside at maximum response`, () => {
    const r = simulate({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }, 180, { width, height, strength: 2 });
    for (const path of r.paths) for (const [x, y] of [path.start, path.end]) {
      assert.ok(x - path.width / 2 > 0 && x + path.width / 2 < width);
      assert.ok(y - path.width / 2 > 0 && y + path.width / 2 < height);
    }
    for (const [x, y, radius] of r.arcs) assert.ok(x - radius > 0 && y - radius > 0 && x + radius < width && y + radius < height);
    for (const [x, y, , , , radius] of r.glows) assert.ok(x - radius > 0 && y - radius > 0 && x + radius < width && y + radius < height);
  });
}

test('a particle reaching the inner boundary is clamped and reflected without a position jump', () => {
  const r = fixture(), state = r.style.snapshot(), margin = 720 * .04;
  state.particles = [{ x: margin + 1, y: 640, vx: -144, vy: 0, age: 0, life: 2,
    radius: .5, hue: 170, energy: 1, sparkle: .1, phase: 0, glow: false }];
  r.style.restore(state); r.step({ ...input, volume: 0 }); const p = r.style.snapshot().particles[0];
  assert.equal(p.x, margin); assert.ok(p.vx > 0); assert.ok(Math.abs(p.x - (margin + 1)) < 2);
});

test('particle count and per-frame glow cost remain bounded under continuous bursts', () => {
  const r = fixture({ capture: false, strength: 2 }); let reached = 0;
  for (let i = 0; i < 600; i++) {
    const before = r.glowCalls(); r.step({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }, i);
    const count = r.style.snapshot().particles.length; reached = Math.max(reached, count);
    assert.ok(count <= PARTICLE_LIMIT); assert.ok(r.glowCalls() - before <= PARTICLE_GLOW_LIMIT);
  }
  assert.equal(reached, PARTICLE_LIMIT);
});

test('silence stops births, lets old particles finish their lifetime and preserves the RNG cursor', () => {
  const r = simulate(input), state = r.style.snapshot(); assert.ok(state.particles.length);
  for (let i = 0; i < 100; i++) r.step({ ...input, volume: 0, high: 1, beat: true }, i);
  const end = r.style.snapshot(); assert.equal(end.particles.length, 0);
  assert.equal(end.randomState, state.randomState); assert.equal(end.emissionCredit, state.emissionCredit);
});

test('snapshot restores positions, velocities, ages, emission credit and the next random sequence', () => {
  const r = fixture(); for (let i = 0; i < 90; i++) r.step(organicStress(i), i);
  const saved = r.style.snapshot(); r.paths.length = 0; r.arcs.length = 0; r.glows.length = 0;
  for (let i = 90; i < 150; i++) r.step(organicStress(i), i);
  const expected = structuredClone({ paths: r.paths, arcs: r.arcs, glows: r.glows, state: r.style.snapshot() });
  r.style.restore(saved); r.paths.length = 0; r.arcs.length = 0; r.glows.length = 0;
  for (let i = 90; i < 150; i++) r.step(organicStress(i), i);
  assert.deepEqual({ paths: r.paths, arcs: r.arcs, glows: r.glows, state: r.style.snapshot() }, expected);
});

test('same-seed reset repeats all particles and a different seed changes them', () => {
  const r = simulate(input), expected = r.style.snapshot(); r.reset();
  for (let i = 0; i < 90; i++) r.step(input, i); assert.deepEqual(r.style.snapshot(), expected);
  r.reset(54321); for (let i = 0; i < 90; i++) r.step(input, i); assert.notDeepEqual(r.style.snapshot().particles, expected.particles);
});

test('ten-minute simulation retains finite bounded state', () => {
  const r = fixture({ capture: false }); for (let i = 0; i < 18000; i++) r.step(organicStress(i), i);
  const state = r.style.snapshot(); assert.ok(state.particles.length <= PARTICLE_LIMIT);
  assert.ok(Number.isFinite(state.clock) && state.emissionCredit >= 0 && state.emissionCredit < 1);
  assert.ok(state.particles.every(p => [p.x, p.y, p.vx, p.vy, p.age].every(Number.isFinite)));
});

test('invalid restore data is rejected without replacing active particle state', () => {
  const r = simulate(input), saved = r.style.snapshot();
  for (const change of [s => { s.clock = NaN; }, s => { s.emissionCredit = 1; },
    s => { s.particles[0].vx = Infinity; }, s => { s.particles[0].age = s.particles[0].life; },
    s => { s.particles = Array.from({ length: PARTICLE_LIMIT + 1 }, () => s.particles[0]); }]) {
    const broken = structuredClone(saved); change(broken); assert.throws(() => r.style.restore(broken), /復元データ/);
    assert.deepEqual(r.style.snapshot(), saved);
  }
});

test('dispose clears live particles', () => {
  const r = simulate(input); r.style.dispose(); assert.equal(r.style.snapshot().particles.length, 0);
});
