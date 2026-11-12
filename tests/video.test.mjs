import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../dist/audio.js';
import { StudioController } from '../dist/controller.js';
import { VideoExporter, recordingSupport, RECORD_LIMIT_BYTES } from '../dist/video.js';
class Target extends EventTarget {
  constructor() { super(); this.listeners = new Set(); }
  addEventListener(type, fn) { super.addEventListener(type, fn); this.listeners.add(fn); }
  removeEventListener(type, fn) { super.removeEventListener(type, fn); this.listeners.delete(fn); }
  emit(type) { this.dispatchEvent(new Event(type)); }
}
class Track extends Target {
  constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.requests = 0; }
  stop() { this.readyState = 'ended'; }
  requestFrame() { this.requests++; }
}
class Stream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
}
const flush = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
async function fixture(options = {}) {
  const document = new Target(); document.hidden = false;
  const rafs = new Map(), timers = new Map(), recorders = [], streams = [], revoked = [], sources = [], destinations = [];
  let id = 0;
  const context = new Target(); Object.assign(context, { state: 'running', currentTime: 0, destination: {},
    resume: options.resume ?? (async () => {}),
    createBufferSource() {
      if (options.sourceCreationThrows) throw new Error('source creation');
      const source = { connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; },
        start(when, offset) { if (options.sourceStartThrows) throw new Error('source start'); this.when = when; this.offset = offset; if (options.startNeedsData) { assert.ok(streams.at(-1).getVideoTracks()[0].requests > 0); queueMicrotask(() => recorders.at(-1)?.onstart?.()); } },
        stop() { this.stopped = true; } }; sources.push(source); return source;
    },
    createMediaStreamDestination() {
      const destination = { stream: new Stream([new Track('audio')]), disconnect() { this.disconnected = true; } };
      destinations.push(destination); return destination;
    } });
  class Recorder {
    static isTypeSupported(type) { return !options.unsupported && type.startsWith('video/webm'); }
    constructor(stream, config) { if (options.constructorThrows) throw new Error('constructor failed'); Object.assign(this, { stream, mimeType: config.mimeType, config, state: 'inactive' }); recorders.push(this); }
    start() { if (options.recorderStartThrows) throw new Error('recorder start'); this.state = 'recording'; if (!options.neverStart && !options.startNeedsData) queueMicrotask(() => this.onstart?.()); }
    stop() {
      this.state = 'inactive'; if (options.neverStop) return;
      queueMicrotask(() => {
        if (options.finalError) this.onerror?.();
        if (options.finalOversize) this.ondataavailable?.({ data: { size: RECORD_LIMIT_BYTES + 1 } });
        else if (!options.empty) this.ondataavailable?.({ data: new Blob(['final-chunk']) });
        this.onstop?.();
      });
    }
  }
  const audio = new AudioEngine(); audio.context = context;
  const renderer = { frame: 0, frames: [], settings: { style: 'organic', theme: 'aurora', strength: 1, trail: 'accumulate' },
    canvas: { width: 720, height: 1280, captureStream(rate) { assert.equal(rate, 0); const track = new Track('video');
      if (options.noRequestFrame) track.requestFrame = undefined;
      const stream = new Stream([track]); streams.push(stream); return stream; } },
    reset(seed, metadata) { this.seed = seed; this.metadata = metadata; this.frame = 0; this.frames = []; },
    configure(settings, size) { Object.assign(this.settings, settings); if (size) [this.canvas.width, this.canvas.height] = size; this.reset(this.seed, this.metadata); },
    step(feature) { assert.ok(feature); this.frames.push(feature); this.frame++; }, present() {},
    snapshotKey() { return JSON.stringify({ seed: this.seed, metadata: this.metadata, settings: this.settings }); },
    snapshot() { return { key: this.snapshotKey(), frame: this.frame, styleState: { frames: [...this.frames] }, layers: {} }; },
    restore(saved) { assert.equal(saved.key, this.snapshotKey()); this.frame = saved.frame; this.frames = [...saved.styleState.frames]; } };
  const studio = new StudioController(audio, renderer, () => {}, async () => {});
  const duration = options.duration ?? .21;
  await studio.load(async () => ({ seed: 42, buffer: { duration }, features: Array.from({ length: Math.ceil(duration * 30) }, (_, i) => ({ volume: .5, i })) }), 'fixture.wav');
  await studio.seek(.1);
  const env = { document, Recorder, Stream, raf(fn) { const n = ++id; rafs.set(n, fn); return n; }, cancelRaf(n) { rafs.delete(n); },
    setTimer(fn, ms) { const n = ++id; timers.set(n, { fn: () => { timers.delete(n); fn(); }, ms }); return n; }, clearTimer(n) { timers.delete(n); },
    createURL: () => 'blob:fixture', revokeURL: url => revoked.push(url) };
  const video = new VideoExporter(studio, () => {}, env);
  const frame = async time => {
    if (time !== undefined) context.currentTime = sources.at(-1).when + time;
    const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(fn => fn()); await flush();
  };
  const boot = async () => { const done = video.start(); await flush(); await frame(); assert.equal(video.state, 'recording'); return { done }; };
  const finish = async () => { for (const time of [.1, .2, duration + .001]) await frame(time); await frame(); await frame(); await flush(); };
  const resourcesReleased = () => {
    assert.equal(rafs.size, 0); assert.equal(timers.size, 0); assert.equal(document.listeners.size, 0); assert.equal(context.listeners.size, 0);
    assert.ok(streams.every(s => s.getTracks().every(t => t.readyState === 'ended' && t.listeners.size === 0)));
    assert.ok(destinations.every(d => d.disconnected && d.stream.getTracks().every(t => t.readyState === 'ended')));
    assert.ok(recorders.every(r => !r.ondataavailable && !r.onstop && !r.onstart && !r.onerror));
    assert.equal(studio.exporting, false); assert.equal(audio.playing, false);
  };
  return { audio, context, renderer, studio, video, env, document, rafs, timers, recorders, sources, destinations, revoked, streams, frame, boot, finish, resourcesReleased };
}

test('support checks explain missing recorder, canvas, audio and WebM format', async () => {
  const f = await fixture();
  assert.match(recordingSupport(f.renderer.canvas, f.audio, { ...f.env, Recorder: null }).reason, /WebM/);
  assert.match(recordingSupport({}, f.audio, f.env).reason, /キャンバス/);
  assert.match(recordingSupport(f.renderer.canvas, { context: {} }, f.env).reason, /音声/);
  const unsupported = await fixture({ unsupported: true }); assert.equal(unsupported.video.canStart, false);
  assert.match(unsupported.video.support.reason, /形式/);
});
test('normal recording includes both tracks, final data, final partial frame and restores a paused position', async () => {
  const f = await fixture(); await f.studio.togglePlay(); const { done } = await f.boot();
  assert.equal(f.audio.source, null); assert.equal(f.studio.canSave, false); assert.equal(f.studio.canConfigure, false);
  assert.deepEqual(f.recorders[0].stream.getTracks().map(t => t.kind), ['video', 'audio']);
  assert.equal(f.sources.at(-1).connections.length, 2); assert.equal(f.sources.at(-1).offset, 0);
  await f.finish(); await done;
  assert.equal(f.video.state, 'ready'); assert.equal(await f.video.blob.text(), 'final-chunk'); assert.equal(f.video.info.finalFrame, 7);
  assert.equal(f.renderer.frame, 3); assert.equal(f.audio.time, .1); assert.ok(f.studio.canSave); f.resourcesReleased();
});
test('recording freezes track, style, theme, ratio, seek, restart and normal playback requests', async () => {
  const f = await fixture(); const { done } = await f.boot(); const frame = f.renderer.frame; let loaded = false;
  await f.studio.load(async () => { loaded = true; }, 'other'); await f.studio.configure({ theme: 'ember' }, [1080, 1080]);
  await f.studio.seek(.2); f.studio.restart(); await f.studio.togglePlay(); f.studio.tick();
  assert.equal(loaded, false); assert.equal(f.renderer.settings.theme, 'aurora'); assert.equal(f.renderer.canvas.width, 720); assert.equal(f.renderer.frame, frame);
  f.video.cancel(); await done; assert.equal(f.video.blob, null); f.resourcesReleased();
});
test('cancel discards chunks, restores the old position, and permits a second recording', async () => {
  const f = await fixture(); let { done } = await f.boot(); f.recorders[0].ondataavailable({ data: new Blob(['partial']) });
  f.video.cancel(); await done; assert.equal(f.video.state, 'idle'); assert.equal(f.video.url, null); assert.equal(f.audio.time, .1); f.resourcesReleased();
  ({ done } = await f.boot()); await f.finish(); await done; assert.equal(f.video.state, 'ready'); f.resourcesReleased();
});
test('double start does not allocate another stream or audio source', async () => {
  const f = await fixture(); const { done } = await f.boot(); await f.video.start(); assert.equal(f.recorders.length, 1); f.video.cancel(); await done;
});
for (const option of ['constructorThrows', 'recorderStartThrows', 'sourceStartThrows', 'sourceCreationThrows', 'noRequestFrame']) test(`${option}: preparation failure frees resources and restores controls`, async () => {
  const f = await fixture({ [option]: true }); const work = f.video.start(); await flush(); await f.frame(); await flush(); await work;
  assert.equal(f.video.state, 'error'); assert.equal(f.video.blob, null); f.resourcesReleased();
});
test('unsupported environment does not start a recording or pause a usable track', async () => {
  const f = await fixture({ unsupported: true }); await f.studio.togglePlay(); await f.video.start();
  assert.equal(f.audio.playing, true); assert.equal(f.studio.exporting, false); assert.equal(f.recorders.length, 0);
});
test('cancel during a pending AudioContext resume cannot resurrect a stale job', async () => {
  let resume; const f = await fixture({ resume: () => new Promise(r => resume = r) });
  const work = f.video.start(); await flush(); f.video.cancel(); await flush(); resume(); await work;
  assert.equal(f.recorders.length, 0); assert.equal(f.video.state, 'idle'); f.resourcesReleased();
});
for (const cause of ['hidden', 'audio', 'track', 'recorder', 'lag']) test(`${cause}: interrupted recording is not saved`, async () => {
  const f = await fixture({ duration: 2 }); const { done } = await f.boot();
  if (cause === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); }
  if (cause === 'audio') { f.context.state = 'suspended'; f.context.emit('statechange'); }
  if (cause === 'track') f.streams[0].getVideoTracks()[0].emit('ended');
  if (cause === 'recorder') { f.recorders[0].state = 'inactive'; f.recorders[0].onstop(); }
  if (cause === 'lag') await f.frame(1);
  await done; assert.equal(f.video.state, 'error'); assert.equal(f.video.blob, null); f.resourcesReleased();
});
for (const option of ['empty', 'finalError', 'finalOversize']) test(`${option}: finalization failure never exposes a completed file`, async () => {
  const f = await fixture({ [option]: true }); const { done } = await f.boot(); await f.finish(); await done;
  assert.equal(f.video.state, 'error'); assert.equal(f.video.blob, null); f.resourcesReleased();
});
test('capacity guard aborts instead of keeping unlimited encoded chunks', async () => {
  const f = await fixture(); const { done } = await f.boot(); f.recorders[0].ondataavailable({ data: { size: RECORD_LIMIT_BYTES + 1 } }); await done;
  assert.equal(f.video.blob, null); assert.match(f.video.message, /256MiB/); f.resourcesReleased();
});
test('missing start event times out and restores controls', async () => {
  const f = await fixture({ neverStart: true }); const done = f.video.start(); await flush();
  const timer = [...f.timers.values()].find(t => t.ms === 10000); timer.fn(); await done; assert.equal(f.video.state, 'error'); f.resourcesReleased();
});
test('missing stop event times out and releases tracks instead of hanging forever', async () => {
  const f = await fixture({ neverStop: true }); const { done } = await f.boot(); f.video.cancel(); await flush();
  const timer = [...f.timers.values()].find(t => t.ms === 5000); timer.fn(); await done; assert.equal(f.video.blob, null); f.resourcesReleased();
});
test('old Blob URLs are revoked when replacing output and on page disposal', async () => {
  const f = await fixture(); let { done } = await f.boot(); await f.finish(); await done;
  ({ done } = await f.boot()); assert.deepEqual(f.revoked, ['blob:fixture']); await f.finish(); await done;
  f.video.dispose(); assert.equal(f.revoked.length, 2); assert.equal(f.video.canStart, false); assert.equal(f.video.blob, null);
});
test('page disposal during recording releases resources without waiting for restoration', async () => {
  const f = await fixture(); const { done } = await f.boot(); f.video.dispose(); await done;
  assert.equal(f.video.blob, null); f.resourcesReleased();
});


test('an encoder waiting for first media data does not deadlock audio startup', async () => {
  const f = await fixture({ startNeedsData: true }); const { done } = await f.boot(); await f.finish(); await done;
  assert.equal(f.video.state, 'ready'); f.resourcesReleased();
});
test('restoration failure still unlocks controls and releases recording resources', async () => {
  const f = await fixture(); const { done } = await f.boot(); f.studio.restore = async () => { throw new Error('restore failure'); };
  await f.finish(); await done; assert.equal(f.video.state, 'error'); assert.equal(f.video.blob, null); f.resourcesReleased();
});

test('a caught restore failure returning the wrong position is not reported as success', async () => {
  const f = await fixture(); const { done } = await f.boot(); f.studio.restore = async () => { f.audio.setPosition(0); f.renderer.frame = 0; };
  await f.finish(); await done; assert.equal(f.video.state, 'error'); assert.equal(f.video.blob, null); f.resourcesReleased();
});

test('page disposal during restoration prevents stale completion notifications', async () => {
  const f = await fixture(); const { done } = await f.boot(); let release;
  f.studio.restore = () => new Promise(resolve => release = resolve);
  await f.finish(); assert.equal(f.video.state, 'restoring'); let notifications = 0; f.video.notify = () => notifications++;
  f.video.dispose(); release(); await done; await flush();
  assert.equal(notifications, 0); assert.equal(f.video.blob, null); f.resourcesReleased();
});
