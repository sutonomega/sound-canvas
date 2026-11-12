import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../dist/renderer.js';
import { styleRegistry } from '../dist/styles/index.js';
import { frameCount, STEP_RATE } from '../dist/timing.js';

// A protocol double: these tests check lifecycle and drawing commands, not rasterization.
function canvas(width = 36, height = 64, id = 'output') {
  let pixels = new Uint8ClampedArray(width * height * 4);
  const defaults = { globalCompositeOperation: 'source-over', globalAlpha: 1, shadowBlur: 0 };
  const stack = [], calls = [];
  const ctx = {
    ...defaults, calls,
    save() { stack.push(Object.fromEntries(Object.keys(defaults).map(key => [key, this[key]]))); },
    restore() { Object.assign(this, stack.pop()); },
    setTransform() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect() { calls.push({ type: 'fill', composite: this.globalCompositeOperation, color: this.fillStyle }); },
    clearRect() { pixels.fill(0); calls.push({ type: 'clear' }); },
    drawImage(image) { calls.push({ type: 'image', id: image.id, composite: this.globalCompositeOperation }); },
    getImageData() { return { width, height, data: pixels.slice() }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) { pixels = image.data.slice(); },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, stroke() {}, arc() {}, fill() {},
  };
  const resize = () => { pixels = new Uint8ClampedArray(width * height * 4); Object.assign(ctx, defaults); stack.length = 0; };
  return { id, get width() { return width; }, set width(value) { width = value; resize(); },
    get height() { return height; }, set height(value) { height = value; resize(); }, getContext() { return ctx; } };
}

const feature = (frame = 0) => ({ volume: .7, bass: .5, mid: .4, high: .2, beat: frame % 15 === 0, intensity: .6 });
const metadata = { duration: 4, trackKey: 'track-a', analysisVersion: 'analysis-test' };
function fixture(extra = {}) {
  let id = 0;
  return new Renderer(canvas(), { styles: { ...styleRegistry, ...extra }, createCanvas: () => canvas(1, 1, `layer-${++id}`) });
}
function fingerprint(snapshot) {
  return { key: snapshot.key, frame: snapshot.frame, styleState: snapshot.styleState,
    pixels: Object.fromEntries(Object.entries(snapshot.layers).map(([name, surface]) =>
      [name, surface.getContext('2d').getImageData().data])) };
}
function probe(events) {
  return { id: 'probe', version: 'probe-1', create() {
    let count = 0;
    return {
      reset(options) { count = 0; events.push({ type: 'reset', options }); },
      step(options) {
        events.push({ type: 'step', ...options }); count++;
        options.layers.drawing.globalCompositeOperation = 'lighter';
        options.layers.effects.shadowBlur = 99;
      },
      snapshot() { return { count }; }, restore(state) { count = state.count; },
      dispose() { events.push({ type: 'dispose' }); },
    };
  } };
}

test('output composes background, drawing and effects in a fixed order', () => {
  const r = fixture(); r.ctx.calls.length = 0; r.present();
  assert.deepEqual(r.ctx.calls, [
    { type: 'image', id: 'layer-1', composite: 'copy' },
    { type: 'image', id: 'layer-2', composite: 'source-over' },
    { type: 'image', id: 'layer-3', composite: 'source-over' },
  ]);
});

test('registered style receives common features, fixed time and the partial final interval', () => {
  const events = [], r = fixture({ probe: probe(events) });
  r.configure({ style: 'probe' }); r.reset(42, { ...metadata, duration: .11 });
  const input = feature(); for (let i = 0; i < 4; i++) r.step(input);
  const steps = events.filter(event => event.type === 'step');
  assert.deepEqual(steps.map(step => step.frameIndex), [0, 1, 2, 3]);
  assert.equal(steps[1].time, 1 / STEP_RATE); assert.equal(steps[0].dt, 1 / STEP_RATE);
  assert.ok(Math.abs(steps[3].dt - .01) < 1e-12);
  assert.equal(steps[0].features.intensity, .6); assert.notEqual(steps[0].features, input);
  assert.equal(Object.isFrozen(steps[0].features), true);
  assert.equal(Object.isFrozen(steps[0].layers), true);
  assert.equal(steps[0].layers.background, undefined);
  assert.equal(r.step(input), false); assert.equal(r.frame, 4);
});

test('switching a style creates a fresh instance and disposes the previous one', () => {
  const events = [], r = fixture({ probe: probe(events) });
  r.configure({ style: 'probe' }); r.step(feature());
  r.configure({ style: 'organic' });
  assert.equal(events.filter(event => event.type === 'dispose').length, 1);
  r.configure({ style: 'probe' });
  assert.equal(r.snapshot().styleState.count, 0); assert.equal(r.frame, 0);
});

test('style paint state is isolated and effects are cleared on every update', () => {
  const r = fixture({ probe: probe([]) }); r.configure({ style: 'probe' });
  const effects = r.layers.effects.ctx;
  r.step(feature()); r.step(feature());
  assert.equal(r.layers.drawing.ctx.globalCompositeOperation, 'source-over');
  assert.equal(effects.shadowBlur, 0);
  assert.equal(effects.calls.filter(call => call.type === 'clear').length, 2);
});

test('fade batches four ticks with the fractional final interval; accumulate never applies it', () => {
  const r = fixture({ probe: probe([]) }); r.configure({ style: 'probe', trail: 'fade' });
  r.reset(1, { ...metadata, duration: .11 });
  for (let i = 0; i < 4; i++) r.step(feature());
  const fades = r.layers.drawing.ctx.calls.filter(call => call.type === 'fill' && call.composite === 'destination-out');
  const alpha = call => Number(call.color.match(/,([^,]+)\)$/)[1]);
  assert.equal(fades.length, 1);
  assert.ok(Math.abs(alpha(fades[0]) - (1 - Math.pow(1 - .018, 3.3))) < 1e-12);
  r.configure({ trail: 'accumulate' }); r.layers.drawing.ctx.calls.length = 0;
  r.step(feature());
  assert.equal(r.layers.drawing.ctx.calls.some(call => call.composite === 'destination-out'), false);
});

test('reset clears pulse and random state and repeats the same organic state', () => {
  const r = fixture();
  const run = () => { r.reset(234, metadata); for (let i = 0; i < 60; i++) r.step(feature(i)); return fingerprint(r.snapshot()); };
  const first = run(), second = run();
  assert.deepEqual(first, second);
  assert.ok(first.styleState.pulses.length > 0);
  r.reset(234, metadata); const initial = r.snapshot();
  assert.deepEqual(initial.styleState.last, []); assert.deepEqual(initial.styleState.pulses, []);
  assert.equal(initial.styleState.travel, 0); assert.equal(initial.styleState.detailCredit, 0);
  r.reset(234, metadata); assert.deepEqual(r.snapshot().styleState, initial.styleState);
});

test('expired effects do not stay in style state', () => {
  const r = fixture(); r.step(feature(0));
  for (let i = 0; i < 40; i++) r.step({ ...feature(), volume: 0, beat: false });
  assert.equal(r.snapshot().styleState.pulses.length, 0);
});

test('snapshot restores frame, style state and random sequence before continuing', () => {
  const r = fixture(); r.reset(234, metadata);
  for (let i = 0; i < 35; i++) r.step(feature(i));
  const saved = r.snapshot();
  for (let i = 35; i < 90; i++) r.step(feature(i));
  const expected = fingerprint(r.snapshot());
  r.restore(saved); assert.equal(r.frame, 35);
  for (let i = 35; i < 90; i++) r.step(feature(i));
  assert.deepEqual(fingerprint(r.snapshot()), expected);
});

test('snapshots do not share mutable pixels or style arrays with the renderer', () => {
  const r = fixture(); r.step(feature());
  const saved = r.snapshot(), state = structuredClone(saved.styleState);
  const image = saved.layers.drawing.getContext('2d').getImageData(); image.data[0] = 99;
  saved.layers.drawing.getContext('2d').putImageData(image);
  saved.styleState.last[0][0] = -100;
  const current = r.snapshot();
  assert.equal(current.layers.drawing.getContext('2d').getImageData().data[0], 0); assert.deepEqual(current.styleState, state);
});

for (const field of ['seed', 'track', 'analysis', 'duration', 'theme', 'trail', 'strength', 'size', 'style']) {
  test(`incompatible ${field} invalidates a snapshot`, () => {
    const r = fixture({ probe: probe([]) }); r.reset(23, metadata); const saved = r.snapshot();
    if (field === 'seed') r.reset(24);
    if (field === 'track') r.reset(23, { ...metadata, trackKey: 'other' });
    if (field === 'analysis') r.reset(23, { ...metadata, analysisVersion: 'next' });
    if (field === 'duration') r.reset(23, { ...metadata, duration: 5 });
    if (field === 'theme') r.configure({ theme: 'ocean' });
    if (field === 'trail') r.configure({ trail: 'fade' });
    if (field === 'strength') r.configure({ strength: 2 });
    if (field === 'size') r.configure({}, [64, 36]);
    if (field === 'style') r.configure({ style: 'probe' });
    assert.throws(() => r.restore(saved), /復元できません/);
  });
}

test('invalid snapshot pixels, frame and style state are rejected without changing active state', () => {
  const r = fixture(); r.reset(1, metadata); r.step(feature());
  const initial = r.snapshot();
  const initialFingerprint = fingerprint(initial);
  for (const change of [s => { s.layers.effects = canvas(1, 1); },
    s => { s.frame = -1; }, s => { s.styleState.randomState = NaN; }]) {
    const broken = { ...initial, styleState: structuredClone(initial.styleState), layers: { ...initial.layers } }; change(broken);
    assert.throws(() => r.restore(broken)); assert.deepEqual(fingerprint(r.snapshot()), initialFingerprint);
  }
});

test('invalid configuration leaves current style, size and state intact', () => {
  const r = fixture(); r.step(feature()); const initial = fingerprint(r.snapshot());
  for (const patch of [{ style: 'missing' }, { strength: NaN }, { theme: 'missing' }, { trail: 'missing' }, { unknown: true }]) {
    assert.throws(() => r.configure(patch)); assert.deepEqual(fingerprint(r.snapshot()), initial);
  }
  assert.throws(() => r.configure({}, [0, 10])); assert.deepEqual(fingerprint(r.snapshot()), initial);
});

test('resizing updates all layers and resets drawing state', () => {
  const r = fixture(); r.step(feature()); r.configure({}, [64, 36]);
  assert.equal(r.frame, 0);
  for (const layer of Object.values(r.layers)) {
    assert.equal(layer.canvas.width, 64); assert.equal(layer.canvas.height, 36);
  }
  assert.deepEqual(r.snapshot().styleState.last, []);
});

test('deferred presentation advances all steps without compositing intermediate frames', () => {
  const r = fixture(); r.ctx.calls.length = 0;
  for (let i = 0; i < 10; i++) r.step(feature(i), { present: false });
  assert.equal(r.frame, 10); assert.equal(r.ctx.calls.length, 0);
  r.present(); assert.equal(r.ctx.calls.length, 3);
});

test('dispose releases layer canvases, is repeatable and prevents further rendering', () => {
  const r = fixture(); r.dispose(); r.dispose();
  for (const layer of Object.values(r.layers)) assert.equal(layer.canvas.width, 0);
  assert.throws(() => r.step(feature()), /終了/); assert.throws(() => r.snapshot(), /終了/);
});

test('zero time and a fractional song end use the same shared clock', () => {
  assert.equal(frameCount(0, .11), 0); assert.equal(frameCount(.1, .11), 3); assert.equal(frameCount(.11, .11), 4);
});

test('fade cadence derives from restored frame and flushes short endings', () => {
  const r = fixture({ probe: probe([]) }); r.configure({ style: 'probe', trail: 'fade' });
  for (let i = 0; i < 3; i++) r.step(feature()); const saved = r.snapshot();
  const fades = () => r.layers.drawing.ctx.calls.filter(call => call.type === 'fill' && call.composite === 'destination-out');
  assert.equal(fades().length, 0); r.step(feature()); const expected = fades().at(-1);
  assert.ok(Math.abs(Number(expected.color.match(/,([^,]+)\)$/)[1]) - (1 - Math.pow(.982, 4))) < 1e-12);
  r.restore(saved); r.layers.drawing.ctx.calls.length = 0; r.step(feature()); assert.deepEqual(fades(), [expected]);
  r.reset(1, { duration: .01 }); r.layers.drawing.ctx.calls.length = 0; r.step(feature());
  assert.ok(Math.abs(Number(fades()[0].color.match(/,([^,]+)\)$/)[1]) - (1 - Math.pow(.982, .3))) < 1e-12);
});
