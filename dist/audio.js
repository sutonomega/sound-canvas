export const FPS = 30;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const check = signal => signal?.throwIfAborted();

export class AudioEngine {
  constructor() {
    this.context = null; this.source = null;
    this.offset = 0; this.started = 0; this.playing = false;
    this.buffer = null; this.features = []; this.seed = 1;
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
      ? this.offset + this.context.currentTime - this.started : this.offset);
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

  async analyze(buffer, { signal, onProgress } = {}) {
    const count = Math.ceil(buffer.duration * FPS), features = [], rate = buffer.sampleRate;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    let lo = 0, hi = 0, seed = 2166136261, previous = [0, 0, 0, 0], average = 0, peak = .02;
    const al = 1 - Math.exp(-2 * Math.PI * 200 / rate);
    const ah = 1 - Math.exp(-2 * Math.PI * 2400 / rate);
    check(signal);
    for (let f = 0; f < count; f++) {
      let total = 0, low = 0, mid = 0, high = 0;
      const start = Math.floor(f * rate / FPS);
      const end = Math.min(buffer.length, Math.floor((f + 1) * rate / FPS));
      for (let i = start; i < end; i++) {
        let x = 0;
        for (const channel of channels) x += channel[i] / channels.length;
        lo += al * (x - lo); hi += ah * (x - hi);
        total += x * x; low += lo * lo; mid += (hi - lo) ** 2; high += (x - hi) ** 2;
        if (i % 101 === 0) seed = Math.imul(seed ^ Math.round(x * 32767), 16777619) >>> 0;
      }
      let values = [total, low, mid, high].map(x => Math.sqrt(x / Math.max(1, end - start)));
      average = average * .96 + values[1] * .04;
      const beat = values[1] > average * 1.35 && values[1] > .015;
      values = values.map((x, i) => previous[i] = previous[i] * .55 + x * .45);
      features.push({ volume: values[0], bass: values[1], mid: values[2], high: values[3], beat });
      peak = Math.max(peak, values[0]);
      if (f % 120 === 0) {
        onProgress?.(`楽曲を解析しています… ${Math.floor(f / count * 100)}%`);
        await yieldTask(); check(signal);
      }
    }
    for (let i = 0; i < features.length; i++) {
      for (const key of ['volume', 'bass', 'mid', 'high']) features[i][key] = Math.min(1, features[i][key] / peak);
      if (i % 10000 === 0) { await yieldTask(); check(signal); }
    }
    check(signal);
    return { buffer, features, seed };
  }

  commit(track) {
    this.pause();
    this.buffer = track.buffer; this.features = track.features; this.seed = track.seed;
    this.offset = 0;
  }

  feature(frame) { return this.features[frame]; }
}
