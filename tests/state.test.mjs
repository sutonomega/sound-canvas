import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../dist/audio.js';
import { StudioController, frameCount } from '../dist/controller.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function track(seed = 1, duration = 12) {
  return {
    seed, buffer: { duration },
    features: Array.from({ length: Math.ceil(duration * 30) }, (_, frame) => ({ seed, frame })),
  };
}

function context() {
  return {
    currentTime: 0, destination: {}, resume: async () => {}, sources: [],
    createBufferSource() {
      const source = { connect() {}, disconnect() { this.disconnected = true; },
        start(_, offset) { this.offset = offset; }, stop() { this.stopped = true; } };
      this.sources.push(source);
      return source;
    },
  };
}

function fixture(yieldTask = async () => {}) {
  const audio = new AudioEngine(); audio.context = context();
  const renderer = {
    frame: 0, settings: {}, canvas: { width: 720, height: 1280 }, frames: [],
    reset(seed) { this.seed = seed; this.frame = 0; this.frames = []; },
    step(feature) { assert.ok(feature); this.frames.push(feature); this.frame++; },
  };
  const studio = new StudioController(audio, renderer, () => {}, yieldTask);
  return { audio, renderer, studio };
}

test('the last selected song wins even when older decoding completes later', async () => {
  const { studio, audio, renderer } = fixture(), first = deferred(), second = deferred();
  const a = studio.load(() => first.promise, 'old');
  const b = studio.load(() => second.promise, 'new');
  second.resolve(track(2)); await b;
  first.resolve(track(1)); await a;
  assert.equal(studio.name, 'new'); assert.equal(audio.seed, 2); assert.equal(renderer.seed, 2);
  assert.equal(studio.state, 'ready');
});

test('stale errors and progress cannot replace a newer successful load', async () => {
  const { studio } = fixture(), old = deferred(); let report;
  const a = studio.load(options => { report = options.onProgress; return old.promise; }, 'old');
  await studio.load(async () => track(2), 'new');
  report('stale progress'); old.reject(new Error('stale error')); await a;
  assert.equal(studio.name, 'new'); assert.match(studio.message, /解析完了/);
});

test('failed replacement preserves the previous song, position and drawing', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(8), 'previous');
  await studio.seek(7); await studio.togglePlay();
  audio.context.currentTime += 1;
  await studio.load(async () => { throw new DOMException('bad data', 'EncodingError'); }, 'broken');
  assert.equal(studio.name, 'previous'); assert.equal(audio.seed, 8);
  assert.equal(audio.time, 8); assert.equal(audio.playing, false); assert.equal(renderer.frame, 240);
  assert.match(studio.message, /別のMP3/); assert.equal(studio.canSave, true);
});

test('cancelled load never commits, and restores the previous song', async () => {
  const { studio, audio, renderer } = fixture(), candidate = deferred(); let signal;
  await studio.load(async () => track(7), 'previous'); await studio.seek(5);
  const pending = studio.load(options => { signal = options.signal; return candidate.promise; }, 'candidate');
  await studio.cancelLoad();
  assert.equal(signal.aborted, true); assert.equal(audio.time, 5);
  candidate.resolve(track(99)); await pending;
  assert.equal(audio.seed, 7); assert.equal(renderer.frame, 150); assert.match(studio.message, /中止/);
});

test('first load failure and cancellation return to a reusable empty state', async () => {
  const { studio, audio } = fixture(), pending = deferred();
  await studio.load(async () => { throw new Error('invalid'); }, 'invalid');
  assert.equal(studio.state, 'empty'); assert.equal(audio.buffer, null);
  const work = studio.load(() => pending.promise, 'cancel'); await studio.cancelLoad();
  pending.resolve(track()); await work;
  assert.equal(studio.state, 'empty');
  await studio.load(async () => track(3), 'valid'); assert.equal(audio.seed, 3);
});

test('rapid playing seeks preserve playback intent and only draw the last target', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(), 'song'); await studio.togglePlay();
  const first = studio.seek(10), second = studio.seek(3);
  await Promise.all([first, second]);
  assert.equal(audio.playing, true); assert.equal(audio.time, 3); assert.equal(renderer.frame, 90);
  assert.deepEqual(renderer.frames.map(x => x.frame), Array.from({ length: 90 }, (_, i) => i));
});

test('setting change during seek keeps the last settings and playback intent', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(), 'song'); await studio.togglePlay();
  await Promise.all([studio.seek(6), studio.configure({ theme: 'ocean' }, [1280, 720])]);
  assert.equal(audio.playing, true); assert.equal(renderer.frame, 180);
  assert.equal(renderer.settings.theme, 'ocean'); assert.equal(renderer.canvas.width, 1280);
});

test('replacement during restore prevents the old renderer and resume from winning', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(1), 'old'); await studio.togglePlay();
  const restore = studio.seek(10);
  await studio.load(async () => track(2), 'new'); await restore;
  assert.equal(audio.seed, 2); assert.equal(audio.playing, false); assert.equal(renderer.frame, 0);
});

test('restart cancels a pending restore and keeps a clean paused start', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(), 'song'); await studio.togglePlay();
  const restore = studio.seek(8); studio.restart(); await restore;
  assert.equal(audio.time, 0); assert.equal(audio.playing, false); assert.equal(renderer.frame, 0);
});

test('pending AudioContext resume cannot start playback after a new operation', async () => {
  const { studio, audio } = fixture(), gate = deferred();
  await studio.load(async () => track(), 'song');
  audio.context.resume = () => gate.promise;
  const start = studio.togglePlay(); studio.restart(); gate.resolve(); await start;
  assert.equal(audio.playing, false); assert.equal(studio.starting, false);
});

test('a rejected playback resume can be retried', async () => {
  const { studio, audio } = fixture(); await studio.load(async () => track(), 'song');
  audio.context.resume = async () => { throw new Error('blocked'); }; await studio.togglePlay();
  assert.equal(audio.playing, false); assert.match(studio.status, /開始できません/);
  audio.context.resume = async () => {}; await studio.togglePlay(); assert.equal(audio.playing, true);
});

test('final partial frame is drawn once and end playback resets drawing and audio', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(1, .11), 'short');
  audio.setPosition(.11); studio.tick(); studio.tick();
  assert.equal(frameCount(.11, .11), 4); assert.equal(renderer.frame, 4); assert.equal(studio.canSave, true);
  await studio.togglePlay(); assert.equal(audio.time, 0); assert.equal(renderer.frame, 0);
});

test('natural end disconnects source and stale end callbacks do not stop a new source', () => {
  const { audio } = fixture(); audio.commit(track()); audio.play();
  const old = audio.source, onEnded = old.onended;
  audio.setPosition(2); audio.play(); const current = audio.source;
  onEnded(); assert.equal(audio.source, current); assert.equal(audio.playing, true);
  current.onended(); assert.equal(audio.source, null); assert.equal(current.disconnected, true);
  assert.equal(audio.time, 12); assert.equal(audio.playing, false);
});

test('seek clamps invalid and out of range input without restarting end position', () => {
  const { audio } = fixture(); audio.commit(track());
  audio.setPosition(-4); assert.equal(audio.time, 0);
  audio.setPosition(Infinity); assert.equal(audio.time, 0);
  audio.setPosition(999); assert.equal(audio.time, 12); assert.equal(audio.playing, false);
});

test('decoding candidate does not replace current track and respects cancellation', async () => {
  const { audio } = fixture(), gate = deferred(), abort = new AbortController();
  audio.commit(track(5)); audio.setPosition(2);
  audio.context.decodeAudioData = () => gate.promise;
  const candidate = audio.prepare(new ArrayBuffer(8), { signal: abort.signal });
  abort.abort(); gate.resolve({ duration: 1, length: 8 });
  await assert.rejects(candidate, { name: 'AbortError' });
  assert.equal(audio.seed, 5); assert.equal(audio.time, 2);
});

test('analysis progress permits cancellation without committing a partial result', async () => {
  const { audio } = fixture(), abort = new AbortController(); audio.commit(track(9));
  const samples = new Float32Array(8000);
  await assert.rejects(audio.analyze({ duration: 1, sampleRate: 8000, length: 8000,
    numberOfChannels: 1, getChannelData: () => samples },
  { signal: abort.signal, onProgress: () => abort.abort() }), { name: 'AbortError' });
  assert.equal(audio.seed, 9);
});

test('PNG is unavailable until drawing catches up and throughout restore', async () => {
  const gate = deferred(); const { studio, audio } = fixture(() => gate.promise);
  await studio.load(async () => track(), 'song');
  audio.setPosition(8); assert.equal(studio.canSave, false);
  const restore = studio.seek(2); assert.equal(studio.canSave, false);
  gate.resolve(); await restore; assert.equal(studio.canSave, true);
});

test('seeking to the end while playing stays at the end rather than restarting', async () => {
  const { studio, audio, renderer } = fixture();
  await studio.load(async () => track(), 'song'); await studio.togglePlay();
  await studio.seek(12); studio.tick();
  assert.equal(audio.time, 12); assert.equal(audio.playing, false); assert.equal(renderer.frame, 360);
  assert.match(studio.status, /完成/);
});

test('a failed source start disconnects the candidate and leaves playback stopped', () => {
  const { audio } = fixture(); audio.commit(track());
  const createSource = audio.context.createBufferSource;
  audio.context.createBufferSource = function () {
    const source = createSource.call(this);
    source.start = () => { throw new Error('cannot start'); };
    return source;
  };
  assert.throws(() => audio.play(), /cannot start/);
  assert.equal(audio.source, null); assert.equal(audio.playing, false);
  assert.equal(audio.context.sources[0].disconnected, true);
});

test('successful analysis stays a candidate until commit and keeps the last partial interval', async () => {
  const { audio } = fixture(); audio.commit(track(7)); audio.setPosition(3);
  const samples = Float32Array.from({ length: 901 }, (_, i) => .2 * Math.sin(i));
  const buffer = { duration: 901 / 8000, sampleRate: 8000, length: 901,
    numberOfChannels: 1, getChannelData: () => samples };
  const progress = [];
  const candidate = await audio.analyze(buffer, { onProgress: text => progress.push(text) });
  assert.equal(audio.seed, 7); assert.equal(audio.time, 3);
  assert.equal(candidate.features.length, 4); assert.ok(progress.length);
  assert.ok(candidate.features.every(x => Number.isFinite(x.volume)));
  audio.commit(candidate); assert.equal(audio.buffer, buffer); assert.equal(audio.time, 0);
});
