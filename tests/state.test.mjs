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
    reset(seed, metadata) { this.seed = seed; this.metadata = metadata; this.frame = 0; this.frames = []; },
    configure(settings, size) {
      Object.assign(this.settings, settings);
      if (size) [this.canvas.width, this.canvas.height] = size;
      this.reset(this.seed, this.metadata);
    },
    step(feature) { assert.ok(feature); this.frames.push(feature); this.frame++; },
    present() {},
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
  { signal: abort.signal, onProgress: text => {
    if (text.startsWith('楽曲を解析しています')) abort.abort();
  } }), { name: 'AbortError' });
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

test('controller resets include the active track identity, version and duration', async () => {
  const { studio, renderer } = fixture();
  await studio.load(async () => ({ ...track(7), analysis: { trackKey: 'content-key', version: 'v2' } }), 'song');
  const expected = { trackKey: 'content-key', analysisVersion: 'v2', duration: 12 };
  assert.deepEqual(renderer.metadata, expected);
  await studio.seek(1); assert.deepEqual(renderer.metadata, expected);
  await studio.configure({ theme: 'ocean' }); assert.deepEqual(renderer.metadata, expected);
});

test('same settings and ratio preserve playback, pixels and operation generation', async () => {
  const { studio, audio, renderer } = fixture(); renderer.settings = { style: 'organic', theme: 'aurora', strength: 1, trail: 'accumulate' };
  await studio.load(async () => track(), 'song'); await studio.seek(4); await studio.togglePlay();
  const generation = studio.generation, frames = renderer.frames;
  await studio.configure({ style: 'organic', strength: 1 }, [720, 1280]);
  assert.equal(studio.generation, generation); assert.equal(renderer.frames, frames);
  assert.equal(audio.playing, true); assert.equal(audio.time, 4);
});
test('a no-op during restore does not cancel the pending target or resume intent', async () => {
  const gate = deferred(), { studio, audio, renderer } = fixture(() => gate.promise);
  renderer.settings = { theme: 'aurora' }; await studio.load(async () => track(), 'song'); await studio.togglePlay();
  const pending = studio.seek(7), generation = studio.generation;
  await studio.configure({ theme: 'aurora' }); assert.equal(studio.generation, generation); assert.equal(studio.restoring, true);
  gate.resolve(); await pending; assert.equal(renderer.frame, 210); assert.equal(audio.playing, true);
});
test('rapid style, theme, strength, trail, ratio and seek requests only retain the last result', async () => {
  const { studio, audio, renderer } = fixture(); await studio.load(async () => track(), 'song'); await studio.togglePlay();
  await Promise.all([studio.seek(9), studio.configure({ style: 'watercolor' }), studio.configure({ theme: 'ember' }),
    studio.configure({ strength: .25, trail: 'fade' }, [1080, 1080]), studio.seek(2)]);
  assert.deepEqual(renderer.settings, { style: 'watercolor', theme: 'ember', strength: .25, trail: 'fade' });
  assert.equal(renderer.canvas.width, 1080); assert.equal(renderer.frame, 60); assert.equal(audio.time, 2);
  assert.deepEqual(renderer.frames.map(f => f.frame), Array.from({ length: 60 }, (_, i) => i)); assert.equal(audio.playing, true);
});
test('all setting changes are locked during loading and unlock on cancellation', async () => {
  const { studio, renderer } = fixture(), candidate = deferred(); await studio.load(async () => track(), 'song');
  renderer.settings = { theme: 'aurora' }; const pending = studio.load(() => candidate.promise, 'new');
  assert.equal(studio.canConfigure, false); await studio.configure({ theme: 'ember' }, [1080, 1080]);
  assert.equal(renderer.settings.theme, 'aurora'); assert.equal(renderer.canvas.width, 720);
  await studio.cancelLoad(); assert.equal(studio.canConfigure, true); candidate.resolve(track(2)); await pending;
});
test('rejected settings preserve the current drawing and playing position without rejecting the UI request', async () => {
  const { studio, audio, renderer } = fixture(); await studio.load(async () => track(), 'song'); await studio.seek(3); await studio.togglePlay();
  const frames = renderer.frames, generation = studio.generation; renderer.configure = () => { throw new Error('invalid settings'); };
  await studio.configure({ theme: 'invalid' });
  assert.equal(renderer.frames, frames); assert.equal(studio.generation, generation); assert.equal(audio.playing, true);
  assert.equal(audio.time, 3); assert.match(studio.status, /前の設定/); assert.equal(studio.canSave, true);
});
test('rejected settings during restore do not resume audio before the valid restore finishes', async () => {
  const gate = deferred(), { studio, audio, renderer } = fixture(() => gate.promise);
  await studio.load(async () => track(), 'song'); await studio.togglePlay(); const pending = studio.seek(5);
  renderer.configure = () => { throw new Error('invalid'); }; await studio.configure({ theme: 'invalid' });
  assert.equal(audio.playing, false); assert.equal(studio.restoring, true); gate.resolve(); await pending;
  assert.equal(audio.playing, true); assert.equal(renderer.frame, 150);
});

test('a large drawing delay catches up in bounded batches without skipping or duplicating features', async () => {
  const { studio, audio, renderer } = fixture(); await studio.load(async () => track(1, 20), 'song'); await studio.togglePlay();
  audio.context.currentTime = 10.113;
  studio.tick(); assert.equal(renderer.frame, 90); assert.equal(studio.canSave, false);
  studio.tick(); assert.equal(renderer.frame, 180); studio.tick(); assert.equal(renderer.frame, 270);
  studio.tick(); assert.equal(renderer.frame, 303); assert.equal(studio.canSave, true);
  assert.deepEqual(renderer.frames.map(f => f.frame), Array.from({ length: 303 }, (_, i) => i));
});
test('a pause freezes the target while the audio clock advances and then resumes from the same frame', async () => {
  const { studio, audio, renderer } = fixture(); await studio.load(async () => track(1, 20), 'song'); await studio.togglePlay();
  audio.context.currentTime = 4.1; while (renderer.frame !== studio.target) studio.tick(); await studio.togglePlay();
  assert.equal(renderer.frame, 123); audio.context.currentTime += 100; studio.tick(); assert.equal(renderer.frame, 123);
  await studio.togglePlay(); audio.context.currentTime += 1; assert.equal(audio.time, 5.1); studio.tick(); assert.equal(renderer.frame, 153);
  assert.deepEqual(renderer.frames.map(f => f.frame), Array.from({ length: 153 }, (_, i) => i));
});
test('aligned fractional song end is rendered once without an empty extra tick', async () => {
  const { studio, audio, renderer } = fixture(); const duration = 31 / 30;
  const candidate = track(1, duration); candidate.features = candidate.features.slice(0, 31);
  await studio.load(async () => candidate, 'aligned'); await studio.seek(duration); studio.tick(); studio.tick();
  assert.equal(renderer.frame, 31); assert.equal(audio.time, duration); assert.equal(studio.canSave, true);
});
