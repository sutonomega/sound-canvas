import { Renderer } from './renderer.js';
import { frameCount } from './timing.js';

const environment = () => ({ createCanvas: () => document.createElement('canvas'),
  createRenderer: (canvas, source) => new Renderer(canvas, { styles: source.styles, createCanvas: source.createCanvas }),
  yieldTask: () => new Promise(resolve => setTimeout(resolve, 0)), now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id),
  createURL: blob => URL.createObjectURL(blob), revokeURL: url => URL.revokeObjectURL(url) });

// Owns a separate drawing surface; the preview and its checkpoints are never replaced.
export class PngExporter {
  constructor(studio, notify = () => {}, env = environment()) {
    Object.assign(this, { studio, notify, env });
    this.job = null; this.disposed = false; this.state = 'idle'; this.percent = 0;
    this.message = ''; this.url = null; this.blob = null; this.info = null;
  }
  get busy() { return !!this.job; }
  get canStart() { return !this.disposed && !this.busy && !this.studio.exporting && !!this.studio.audio.buffer
    && !this.studio.loading && !this.studio.restoring && !this.studio.starting; }
  emit() { if (!this.disposed) this.notify(this); }
  clearResult() {
    if (this.url) this.env.revokeURL(this.url);
    this.url = this.blob = this.info = null; this.message = '';
    if (!this.busy) this.state = 'idle';
  }

  async start(kind = 'current') {
    if (!this.canStart || !['current', 'complete'].includes(kind)) return;
    const { audio, renderer } = this.studio;
    this.clearResult(); this.studio.begin(); audio.pause();
    const job = { signal: new AbortController(), canvas: null, renderer: null };
    this.job = job; this.studio.exporting = true;
    this.state = 'rendering'; this.percent = 0;
    this.message = kind === 'complete' ? '曲末の完成アートを生成しています…' : '現在のアートを生成しています…';
    this.emit();
    try {
      const time = kind === 'complete' ? audio.buffer.duration : audio.time;
      const info = { kind, time, name: this.studio.name, width: renderer.canvas.width, height: renderer.canvas.height,
        style: renderer.settings.style, frame: frameCount(time, audio.buffer.duration) };
      await this.env.yieldTask(); job.signal.signal.throwIfAborted();
      job.canvas = this.env.createCanvas(); job.canvas.width = info.width; job.canvas.height = info.height;
      job.renderer = this.env.createRenderer(job.canvas, renderer);
      job.renderer.configure({ ...renderer.settings });
      job.renderer.reset(audio.seed, { duration: audio.buffer.duration,
        trackKey: audio.analysis?.trackKey ?? null, analysisVersion: audio.analysis?.version ?? null });
      while (job.renderer.frame < info.frame) {
        const started = this.env.now(); let steps = 0;
        do {
          job.renderer.step(audio.feature(job.renderer.frame), { present: false }); steps++;
        } while (job.renderer.frame < info.frame && steps < 120 && this.env.now() - started < 8);
        this.percent = Math.floor(job.renderer.frame / info.frame * 95); this.emit();
        await this.env.yieldTask(); job.signal.signal.throwIfAborted();
      }
      job.renderer.present(); this.state = 'encoding'; this.percent = 95;
      this.message = 'PNGファイルを準備しています…'; this.emit();
      const blob = await this.encode(job); job.signal.signal.throwIfAborted();
      this.url = this.env.createURL(blob); this.blob = blob; this.info = info;
      this.state = 'ready'; this.percent = 100;
      this.message = `${kind === 'complete' ? '曲末の完成アート' : '現在のアート'}を準備しました。保存ボタンを押してください。`;
      return blob;
    } catch (error) {
      this.clearResult(); this.state = job.signal.signal.aborted ? 'idle' : 'error';
      this.message = job.signal.signal.aborted ? 'PNG生成を中止しました。元の位置から再生できます。'
        : 'PNGを作成できませんでした。もう一度お試しください。';
      return null;
    } finally {
      job.renderer?.dispose(); if (job.canvas) job.canvas.width = job.canvas.height = 0;
      if (this.job === job) { this.job = null; this.studio.exporting = false; }
      if (!this.disposed) this.studio.status = this.message;
      this.emit();
    }
  }

  encode(job) {
    return new Promise((resolve, reject) => {
      const signal = job.signal.signal; let timer, settled = false;
      const finish = (error, blob) => {
        if (settled) return; settled = true;
        signal.removeEventListener('abort', abort); this.env.clearTimer(timer);
        error ? reject(error) : resolve(blob);
      };
      const abort = () => finish(new Error('cancelled'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      timer = this.env.setTimer(() => finish(new Error('PNG timeout')), 30000);
      try { job.canvas.toBlob(blob => {
        if (!blob || !blob.size || blob.type !== 'image/png') finish(new Error('PNG encoding failed'));
        else finish(null, blob);
      }, 'image/png'); } catch (error) { finish(error); }
    });
  }
  cancel() { this.job?.signal.abort(); }
  dispose() { this.disposed = true; this.cancel(); this.clearResult(); }
}
