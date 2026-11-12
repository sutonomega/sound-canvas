import { analyzeAudio, FEATURE_RATE } from './analysis.js';

export const FPS = FEATURE_RATE;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const check = signal => signal?.throwIfAborted();

export class AudioEngine {
  constructor() {
    this.context = null; this.source = null;
    this.offset = 0; this.started = 0; this.playing = false;
    this.buffer = null; this.features = []; this.seed = 1; this.analysis = null;
  }

  ensureContext() { return this.context ??= new AudioContext(); }
  async init() { await this.ensureContext().resume(); }

  stop() {
    if (this.source) {
      const source = this.source;
      this.source = null;
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.playing = false;
  }

  get time() {
    if (!this.buffer) return 0;
    return Math.min(this.buffer.duration, this.playing
      ? this.offset + (this.context.currentTime - this.started) : this.offset);
  }

  pause() { this.offset = this.time; this.stop(); }

  play() {
    if (!this.buffer) return;
    this.pause();
    if (this.offset >= this.buffer.duration) this.offset = 0;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      this.source = null;
      this.offset = this.buffer.duration;
      this.playing = false;
    };
    try { source.start(0, this.offset); }
    catch (error) { source.onended = null; source.disconnect(); throw error; }
    this.source = source;
    this.started = this.context.currentTime;
    this.playing = true;
  }

  createRecordingSession() {
    if (!this.buffer) throw new Error('先に楽曲を読み込んでください。');
    const context = this.ensureContext(), destination = context.createMediaStreamDestination();
    let source, started = null, ended = false, stopped = false;
    try { source = context.createBufferSource(); source.buffer = this.buffer; source.connect(destination); source.connect(context.destination); }
    catch (error) { source?.disconnect(); destination.disconnect(); destination.stream.getTracks().forEach(track => track.stop()); throw error; }
    source.onended = () => { ended = true; };
    return {
      stream: destination.stream,
      get time() { return ended ? source.buffer.duration : started === null ? 0 : Math.max(0, Math.min(source.buffer.duration, context.currentTime - started)); },
      start(when) { if (stopped || started !== null) throw new Error('録画用の音声を開始できません。'); source.start(when, 0); started = when; },
      stop() {
        if (stopped) return; stopped = true; source.onended = null;
        try { source.stop(); } catch { /* A source may not have started or may already have ended. */ }
        source.disconnect(); destination.disconnect(); destination.stream.getTracks().forEach(track => track.stop());
      },
    };
  }

  setPosition(time) {
    this.pause();
    this.offset = Math.max(0, Math.min(this.buffer?.duration ?? 0, Number.isFinite(time) ? time : 0));
  }

  // Prepare a candidate without touching the active song; commit is explicit.
  async prepare(bytes, options = {}) {
    check(options.signal);
    options.onProgress?.('音源をデコードしています…');
    const buffer = await this.ensureContext().decodeAudioData(bytes.slice(0));
    check(options.signal);
    if (!buffer.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      throw new Error('空の音源は読み込めません。');
    }
    return this.analyze(buffer, options);
  }

  async prepareDemo(options = {}) {
    check(options.signal);
    options.onProgress?.('デモ音源を準備しています…');
    const rate = 22050, duration = 36;
    const buffer = this.ensureContext().createBuffer(1, rate * duration, rate);
    const samples = buffer.getChannelData(0);
    let random = 721;
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate, beat = t % .5;
      const chord = [130.81, 164.81, 196, 146.83][Math.floor(t / 9) % 4];
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const fade = Math.min(1, t / 2, (duration - t) / 3);
      samples[i] = fade * (
        .22 * Math.sin(2 * Math.PI * (48 * beat + 1.7 * (1 - Math.exp(-beat * 35)))) * Math.exp(-beat * 12)
        + .09 * Math.sin(2 * Math.PI * chord * t)
        + .065 * Math.sin(2 * Math.PI * chord * 1.5 * t)
        + .05 * Math.sin(2 * Math.PI * chord * 4 * t) * Math.exp(-(t % .25) * 14)
        + .035 * (random / 2147483648 - 1) * Math.exp(-(t % .25) * 65));
      if (i % rate === 0) { await yieldTask(); check(options.signal); }
    }
    return this.analyze(buffer, options);
  }

  async analyze(buffer, options = {}) {
    const analysis = await analyzeAudio(buffer, options);
    return { buffer, analysis, features: analysis.frames, seed: analysis.seed };
  }

  commit(track) {
    this.pause();
    this.buffer = track.buffer; this.features = track.features; this.seed = track.seed;
    this.analysis = track.analysis ?? null;
    this.offset = 0;
  }

  feature(frame) { return this.features[frame]; }
}
