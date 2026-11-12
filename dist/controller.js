import { CheckpointCache, CHECKPOINT_FRAMES } from './checkpoints.js';
import { frameCount } from './timing.js';
export { frameCount } from './timing.js';

// Owns operation generations and playback intent, independent of the DOM.
export class StudioController {
  constructor(audio, renderer, notify = () => {}, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), { now = () => performance.now(), budgetMs = 8, batchFrames = 120, cache = new CheckpointCache(renderer) } = {}) {
    Object.assign(this, { audio, renderer, notify, yieldTask, now, budgetMs, batchFrames, cache });
    this.progress = null; this.lastRestore = null;
    this.operation = null; this.generation = 0; this.state = 'empty'; this.name = '';
    this.message = '曲全体を解析してから描画します。';
    this.status = '楽曲を読み込んで、制作をはじめましょう';
    this.resumeAfterRestore = false; this.starting = false;
  }

  get loading() { return this.state === 'loading'; }
  get canConfigure() { return !this.loading; }
  get restoring() { return this.state === 'restoring'; }
  get target() { return this.audio.buffer ? frameCount(this.audio.time, this.audio.buffer.duration) : 0; }
  get canSave() {
    return !!this.audio.buffer && !this.loading && !this.restoring && !this.starting
      && this.renderer.frame === this.target;
  }

  begin() {
    this.operation?.abort();
    this.operation = new AbortController(); this.generation++; this.starting = false;
    return this.operation.signal;
  }

  emit() { this.notify(this); }

  resetRenderer() {
    this.renderer.reset(this.audio.seed, {
      trackKey: this.audio.analysis?.trackKey ?? null,
      analysisVersion: this.audio.analysis?.version ?? null,
      duration: this.audio.buffer?.duration ?? null,
    });
    this.cache.sync();
  }

  async load(loader, name) {
    const signal = this.begin();
    this.audio.pause(); this.resumeAfterRestore = false; this.progress = null; this.state = 'loading';
    this.message = '音源を読み込んでいます…';
    this.status = '読み込み中 · 別の曲の選択・中止ができます'; this.emit();
    try {
      const track = await loader({ signal, onProgress: text => {
        if (signal.aborted) return;
        this.message = text; this.emit();
      } });
      if (signal.aborted) return;
      this.audio.commit(track); this.cache.clear(); this.name = name;
      this.resetRenderer(); this.state = 'ready';
      this.message = '解析完了 · 端末外へのアップロードなし';
      this.status = '再生すると、あなたの音楽が描きはじめます'; this.emit();
    } catch (error) {
      if (signal.aborted) return;
      this.message = error.name === 'EncodingError' || error.name === 'NotSupportedError'
        ? '音源を読み込めませんでした。別のMP3・WAVをお試しください。'
        : (error.message || '読み込みに失敗しました。もう一度お試しください。');
      await this.restore(false, this.audio.buffer ? '前の楽曲を再生できます' : 'MP3・WAVを選択してください');
    }
  }

  async cancelLoad() {
    if (!this.loading) return;
    this.message = '読み込みを中止しました。';
    await this.restore(false, this.audio.buffer ? '前の楽曲を再生できます' : 'MP3・WAVを選択してください');
  }

  async restore(resume, status = '同じ曲・同じ設定から生まれる、同じ軌跡') {
    const signal = this.begin(), started = this.now();
    this.audio.pause(); this.resumeAfterRestore = resume;
    if (!this.audio.buffer) {
      this.progress = null; this.state = 'empty'; this.status = status; this.emit(); return;
    }
    const target = this.target;
    this.state = 'restoring'; this.progress = { percent: 0, targetTime: this.audio.time };
    this.status = '軌跡を復元しています… 0%'; this.emit();
    let startFrame = 0, cacheHit = false, slices = 0;
    try {
      // Paint feedback and accept a newer request before touching large snapshot surfaces.
      await this.yieldTask(); if (signal.aborted) return;
      const saved = this.cache.find(target);
      if (saved && (this.renderer.frame > target || saved.frame > this.renderer.frame)) {
        try { this.renderer.restore(saved); cacheHit = true; }
        catch { this.cache.clear(); this.resetRenderer(); }
      } else if (this.renderer.frame > target) this.resetRenderer();
      startFrame = this.renderer.frame;
      while (this.renderer.frame < target) {
        if (signal.aborted) return;
        const sliceStart = this.now(); let steps = 0;
        do {
          this.renderer.step(this.audio.feature(this.renderer.frame), { present: false }); steps++;
          if (this.renderer.frame % CHECKPOINT_FRAMES === 0) this.cache.remember();
        } while (this.renderer.frame < target && steps < this.batchFrames && this.now() - sliceStart < this.budgetMs);
        slices++; this.renderer.present();
        const percent = Math.floor((this.renderer.frame - startFrame) / (target - startFrame) * 100);
        this.progress = { percent, targetTime: this.audio.time };
        this.status = `軌跡を復元しています… ${percent}%`; this.emit();
        if (this.renderer.frame < target) { await this.yieldTask(); if (signal.aborted) return; }
      }
      if (signal.aborted) return;
      this.renderer.present(); this.cache.remember();
      this.lastRestore = { targetFrame: target, startFrame, framesComputed: target - startFrame, cacheHit,
        slices, elapsedMs: this.now() - started };
      this.state = 'ready'; this.status = status;
      if (resume && this.audio.time < this.audio.buffer.duration) this.audio.play();
    } catch (error) {
      if (signal.aborted) return;
      this.cache.clear(); this.audio.setPosition(0); this.resetRenderer(); this.state = 'ready';
      this.status = '復元できませんでした。最初から再生してください。'; this.message = error.message;
    }
    this.progress = null; this.resumeAfterRestore = false; this.emit();
  }

  async seek(time) {
    if (this.loading || !this.audio.buffer) return;
    const resume = this.audio.playing || (this.restoring && this.resumeAfterRestore);
    this.audio.setPosition(time);
    await this.restore(resume);
  }

  async configure(settings, size) {
    if (!this.canConfigure) return;
    const unchanged = Object.entries(settings).every(([key, value]) => Object.hasOwn(this.renderer.settings, key)
      && this.renderer.settings[key] === value) && (!size || (size[0] === this.renderer.canvas.width && size[1] === this.renderer.canvas.height));
    if (unchanged) { this.emit(); return; }
    const resume = this.audio.playing || (this.restoring && this.resumeAfterRestore);
    this.audio.pause();
    try { this.renderer.configure(settings, size); this.cache.sync(); }
    catch (error) {
      this.message = error.message || '設定を適用できませんでした。';
      this.status = '設定を変更できませんでした。前の設定を使います。';
      if (resume && !this.restoring && this.audio.time < this.audio.buffer.duration) this.audio.play();
      this.emit(); return;
    }
    await this.restore(resume);
  }

  cancelRestore() {
    if (this.restoring) this.restart('描き直しを中止しました。最初から再生できます。');
  }

  restart(status = '最初から再生できます') {
    if (this.loading || !this.audio.buffer) return;
    this.begin(); this.audio.setPosition(0); this.resetRenderer();
    this.progress = null; this.resumeAfterRestore = false; this.state = 'ready';
    this.status = status; this.emit();
  }

  async togglePlay() {
    if (!this.audio.buffer || this.loading || this.restoring || this.starting) return;
    if (this.audio.playing) {
      this.audio.pause(); this.status = '一時停止しました。軌跡はそのまま残ります'; this.emit(); return;
    }
    const generation = this.generation;
    this.starting = true; this.emit();
    try {
      await this.audio.init();
      if (generation !== this.generation) return;
      if (this.audio.time >= this.audio.buffer.duration) {
        this.audio.setPosition(0); this.resetRenderer();
      }
      this.audio.play(); this.status = '音楽に合わせて、光の軌跡を描いています';
    } catch {
      if (generation !== this.generation) return;
      this.audio.pause();
      this.status = '再生を開始できませんでした。もう一度再生ボタンを押してください。';
    } finally {
      if (generation === this.generation) { this.starting = false; this.emit(); }
    }
  }

  tick() {
    if (!this.audio.buffer || this.loading || this.restoring) return;
    const target = this.target;
    const before = this.renderer.frame; this.cache.sync();
    for (let n = 0; n < 90 && this.renderer.frame < target; n++) {
      this.renderer.step(this.audio.feature(this.renderer.frame), { present: false });
      if (this.renderer.frame % CHECKPOINT_FRAMES === 0) this.cache.remember();
    }
    if (this.renderer.frame !== before) this.renderer.present();
    if (this.audio.time >= this.audio.buffer.duration && this.renderer.frame === target) {
      this.status = '一曲のアートが完成しました。PNGで保存できます。';
    }
  }
}
