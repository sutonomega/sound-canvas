import test from 'node:test';
import assert from 'node:assert/strict';
import { PngExporter } from '../dist/png.js';
import { AudioEngine } from '../dist/audio.js';
import { StudioController } from '../dist/controller.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function fixture(options = {}) {
  const audio = new AudioEngine(); audio.context = { currentTime: 0, destination: {}, resume: async () => {},
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }) };
  const makeRenderer = canvas => ({ canvas, frame: 0, settings: { style: 'organic', theme: 'aurora', strength: 1, trail: 'accumulate' },
    configure(settings) { this.settings = { ...settings }; }, reset(seed, metadata) { this.seed = seed; this.metadata = metadata; this.frame = 0; },
    step() { if (options.stepThrows && canvas.toBlob) throw new Error('draw'); this.frame++; }, present() { this.presented = this.frame; },
    snapshotKey() { return 'fixture'; }, snapshot() { return { key: 'fixture', frame: this.frame, styleState: {}, layers: {} }; },
    dispose() { this.disposed = true; } });
  const renderer = makeRenderer({ width: 720, height: 1280 });
  const studio = new StudioController(audio, renderer, () => {}, async () => {});
  await studio.load(async () => ({ seed: 42, buffer: { duration: .213 }, analysis: { trackKey: 'full-pcm', version: 'test' },
    features: Array.from({ length: 7 }, () => ({ volume: .5 })) }), 'fixture.wav');
  audio.setPosition(.1); studio.tick();
  const surfaces = [], copies = [], timers = new Map(), revoked = []; let serial = 0, pendingBlob;
  const env = { createCanvas() {
    const surface = { width: 0, height: 0, toBlob(callback, type) {
      assert.equal(type, 'image/png');
      const complete = () => callback(options.nullBlob ? null : new Blob(['encoded'], { type: 'image/png' }));
      if (options.blobThrows) throw new Error('encoder');
      if (options.deferBlob) pendingBlob = complete; else queueMicrotask(complete);
    } }; surfaces.push(surface); return surface;
  }, createRenderer(canvas) { const copy = makeRenderer(canvas); copies.push(copy); return copy; },
  yieldTask: options.yieldTask ?? (async () => {}), now: () => 0,
  setTimer(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); },
  createURL: () => `blob:${++serial}`, revokeURL: url => revoked.push(url) };
  const png = new PngExporter(studio, () => {}, env);
  return { audio, renderer, studio, png, surfaces, copies, timers, revoked, takeBlob: () => pendingBlob, finishBlob: () => pendingBlob?.() };
}

for (const kind of ['current', 'complete']) test(`${kind} PNG uses a dedicated renderer and preserves the paused preview position`, async () => {
  const f = await fixture(); await f.studio.togglePlay(); const before = f.renderer.frame;
  assert.ok(await f.png.start(kind));
  assert.equal(f.png.info.frame, kind === 'complete' ? 7 : 3);
  assert.equal(f.copies[0].presented, f.png.info.frame);
  assert.equal(f.renderer.frame, before); assert.equal(f.audio.time, .1); assert.equal(f.audio.playing, false);
  assert.equal(f.png.info.kind, kind); assert.equal(f.png.info.width, 720); assert.equal(f.png.info.height, 1280);
  assert.equal(f.copies[0].metadata.duration, .213); assert.equal(f.copies[0].seed, 42);
  assert.equal(f.copies[0].disposed, true); assert.equal(f.surfaces[0].width, 0);
  assert.equal(f.studio.exporting, false); assert.equal(f.timers.size, 0);
});

test('PNG refuses empty/loading/restoring/starting and an existing export without stealing its lock', async () => {
  const f = await fixture();
  for (const state of ['loading', 'restoring']) { f.studio.state = state; assert.equal(await f.png.start(), undefined); }
  f.studio.state = 'ready'; f.studio.starting = true; assert.equal(f.png.canStart, false); f.studio.starting = false;
  f.studio.exporting = true; assert.equal(await f.png.start(), undefined); assert.equal(f.studio.exporting, true);
  f.studio.exporting = false; f.audio.buffer = null; assert.equal(f.png.canStart, false);
});

test('pending encoding locks all studio operations and refuses duplicate PNG jobs', async () => {
  const f = await fixture({ deferBlob: true }), done = f.png.start('complete'); await flush();
  assert.equal(f.png.state, 'encoding'); assert.equal(await f.png.start(), undefined);
  let loaded = false; await f.studio.load(async () => { loaded = true; }, 'other');
  await f.studio.seek(.2); await f.studio.configure({ theme: 'ember' }); f.studio.restart(); await f.studio.togglePlay(); f.studio.tick();
  assert.equal(loaded, false); assert.equal(f.audio.time, .1); assert.equal(f.renderer.settings.theme, 'aurora');
  assert.equal(f.studio.canSave, false); assert.equal(f.studio.canConfigure, false); assert.equal(f.audio.playing, false);
  f.finishBlob(); await done; assert.equal(f.png.state, 'ready');
});

test('cancel during drawing publishes no partial image and permits a retry', async () => {
  let release; const f = await fixture({ yieldTask: () => new Promise(resolve => { release = resolve; }) });
  const done = f.png.start('complete'); f.png.cancel(); release(); assert.equal(await done, null);
  assert.equal(f.png.url, null); assert.equal(f.studio.exporting, false); assert.equal(f.audio.time, .1);
  f.png.env.yieldTask = async () => {}; assert.ok(await f.png.start('complete'));
});

test('cancel during encoding ignores a late callback even after a new successful job', async () => {
  const f = await fixture({ deferBlob: true }), done = f.png.start(); await flush(); const late = f.takeBlob();
  f.png.cancel(); assert.equal(await done, null); assert.equal(f.png.url, null);
  const second = f.png.start('complete'); await flush(); f.finishBlob(); await second;
  const url = f.png.url; late(); await flush(); assert.equal(f.png.url, url);
  assert.ok(url); assert.equal(f.png.state, 'ready'); assert.equal(f.timers.size, 0);
});

for (const option of ['nullBlob', 'blobThrows', 'stepThrows']) test(`${option} releases resources and reports failure without a download`, async () => {
  const f = await fixture({ [option]: true }); assert.equal(await f.png.start('complete'), null);
  assert.equal(f.png.state, 'error'); assert.equal(f.png.url, null); assert.equal(f.studio.exporting, false);
  assert.equal(f.audio.time, .1); assert.equal(f.copies[0].disposed, true); assert.equal(f.surfaces[0].height, 0); assert.equal(f.timers.size, 0);
});

test('encoding timeout releases the export lock and discards a late blob', async () => {
  const f = await fixture({ deferBlob: true }), done = f.png.start(); await flush();
  [...f.timers.values()][0](); assert.equal(await done, null); f.finishBlob(); await flush();
  assert.equal(f.png.url, null); assert.equal(f.png.state, 'error'); assert.equal(f.studio.exporting, false);
});

test('results revoke on replacement and disposal; disposal suppresses late completion', async () => {
  const f = await fixture(); await f.png.start(); const old = f.png.url;
  await f.png.start('complete'); assert.ok(f.revoked.includes(old)); const final = f.png.url;
  f.png.dispose(); assert.ok(f.revoked.includes(final)); assert.equal(f.png.canStart, false);
  const g = await fixture({ deferBlob: true }), done = g.png.start(); await flush(); g.png.dispose();
  await done; g.finishBlob(); await flush(); assert.equal(g.png.url, null); assert.equal(g.studio.exporting, false);
});
