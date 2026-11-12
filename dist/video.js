import { frameCount, STEP_RATE } from './timing.js';

export const WEBM_TYPES = Object.freeze(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']);
export const RECORD_LIMIT_BYTES = 256 * 1024 * 1024;
export const RECORD_MAX_LAG_SECONDS = .2;
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const browserEnvironment = () => ({ Recorder: globalThis.MediaRecorder, Stream: globalThis.MediaStream,
  document: globalThis.document, raf: callback => requestAnimationFrame(callback), cancelRaf: id => cancelAnimationFrame(id),
  setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: id => clearTimeout(id),
  createURL: blob => URL.createObjectURL(blob), revokeURL: url => URL.revokeObjectURL(url) });

export function recordingSupport(canvas, audio, env = browserEnvironment()) {
  if (!env.Recorder || typeof env.Recorder.isTypeSupported !== 'function') return { supported: false, reason: 'このブラウザはWebM録画に対応していません。PNG保存は利用できます。' };
  if (typeof canvas.captureStream !== 'function' || !env.Stream) return { supported: false, reason: 'このブラウザはキャンバスの動画保存に対応していません。PNG保存は利用できます。' };
  if (typeof (audio.context?.createMediaStreamDestination ?? globalThis.AudioContext?.prototype?.createMediaStreamDestination) !== 'function') return { supported: false, reason: 'このブラウザは録画用の音声出力に対応していません。PNG保存は利用できます。' };
  const mimeType = WEBM_TYPES.find(type => env.Recorder.isTypeSupported(type));
  return mimeType ? { supported: true, mimeType, reason: '' } : { supported: false, reason: '音声付きWebMに対応する形式がありません。別のPCブラウザをお試しください。' };
}

export class VideoExporter {
  constructor(studio, notify = () => {}, env = browserEnvironment()) {
    this.studio = studio; this.audio = studio.audio; this.renderer = studio.renderer; this.notify = notify; this.env = env;
    this.state = 'idle'; this.message = ''; this.elapsed = 0; this.percent = 0; this.job = null;
    this.blob = null; this.url = null; this.info = null; this.disposed = false;
    this.support = recordingSupport(this.renderer.canvas, this.audio, env);
  }
  get busy() { return !!this.job; }
  get canStart() { return !this.disposed && this.support.supported && !this.busy && !this.studio.exporting && !!this.audio.buffer && !this.studio.loading && !this.studio.restoring && !this.studio.starting; }
  emit() { this.notify(this); }
  clearResult() { if (this.url) this.env.revokeURL(this.url); this.url = null; this.blob = null; this.info = null; }
  active(job) { return this.job === job && !job.finishing && !this.disposed; }

  async start() {
    if (!this.canStart) return;
    this.clearResult(); this.studio.begin(); this.audio.pause();
    const job = { done: deferred(), started: deferred(), stopped: deferred(), rafs: new Set(), timers: new Set(), cleanups: [],
      chunks: [], bytes: 0, position: this.audio.time, name: this.studio.name, duration: this.audio.buffer.duration,
      finishing: false, reason: '', cancelled: false, videoStream: null, stream: null, session: null, recorder: null };
    this.job = job; this.studio.exporting = true; this.studio.cache.remember();
    this.state = 'preparing'; this.elapsed = this.percent = 0; this.message = '録画を準備しています…'; this.emit();
    this.listen(job, this.env.document, 'visibilitychange', () => { if (this.env.document.hidden) this.fail(job, '画面が非表示になったため録画を中止しました。'); });
    this.timer(job, () => this.fail(job, '録画を開始できませんでした。もう一度お試しください。'), 10000);
    try {
      await this.audio.init(); if (!this.active(job)) return job.done.promise;
      if (this.env.document.hidden) throw new Error('画面を表示した状態で録画してください。');
      this.studio.resetRenderer();
      job.session = this.audio.createRecordingSession();
      job.videoStream = this.renderer.canvas.captureStream(0);
      const video = job.videoStream.getVideoTracks(), audio = job.session.stream.getAudioTracks();
      if (video.length !== 1 || audio.length !== 1 || typeof video[0].requestFrame !== 'function') throw new Error('このブラウザでは音声付きのキャンバス録画を開始できません。別のPCブラウザをお試しください。');
      job.videoTrack = video[0]; job.stream = new this.env.Stream([...video, ...audio]);
      for (const track of job.stream.getTracks()) {
        if (track.readyState !== 'live') throw new Error('録画用の音声・映像を準備できませんでした。');
        this.listen(job, track, 'ended', () => this.fail(job, '音声または映像が停止したため録画を中止しました。'));
      }
      this.listen(job, this.audio.context, 'statechange', () => { if (this.audio.context.state !== 'running') this.fail(job, '音声の再生が停止したため録画を中止しました。'); });
      job.recorder = new this.env.Recorder(job.stream, { mimeType: this.support.mimeType, videoBitsPerSecond: 5000000, audioBitsPerSecond: 160000 });
      job.recorder.onstart = () => job.started.resolve(true);
      job.recorder.onstop = () => {
        job.stopped.resolve(true);
        if (this.active(job)) this.fail(job, '録画が途中で停止しました。もう一度お試しください。');
      };
      job.recorder.onerror = () => this.fail(job, '動画を記録できませんでした。もう一度お試しください。');
      job.recorder.ondataavailable = event => {
        if (job.cancelled || this.job !== job || !event.data?.size) return;
        job.bytes += event.data.size;
        if (job.bytes > RECORD_LIMIT_BYTES) { this.fail(job, '動画が保存できる容量（256MiB）を超えたため中止しました。'); return; }
        job.chunks.push(event.data);
      };
      job.recorder.start(1000);
      // Some encoders emit start only after every track supplies data. Prime both tracks
      // after start(), and use the scheduled audio clock while awaiting that event.
      this.renderer.present(); job.videoTrack.requestFrame();
      job.session.start(this.audio.context.currentTime + .1);
      this.schedule(job, () => this.pump(job));
      const started = await Promise.race([job.started.promise, job.done.promise.then(() => false)]);
      if (!started || !this.active(job)) return job.done.promise;
      this.clearTimers(job);
      if (this.state !== 'finishing') {
        this.state = 'recording'; this.message = '録画中です。この画面を表示したままお待ちください。'; this.emit();
      }
    } catch (error) { this.fail(job, error.message || '録画を開始できませんでした。'); }
    return job.done.promise;
  }

  pump(job) {
    if (!this.active(job)) return;
    try {
      if (this.env.document.hidden) throw new Error('画面が非表示になったため録画を中止しました。');
      if (this.audio.context.state !== 'running') throw new Error('音声の再生が停止したため録画を中止しました。');
      const time = job.session.time, target = frameCount(time, job.duration);
      if (target - this.renderer.frame > Math.ceil(RECORD_MAX_LAG_SECONDS * STEP_RATE)) throw new Error('描画が録画に追いつかなくなったため中止しました。負荷を下げて再度お試しください。');
      while (this.renderer.frame < target) this.renderer.step(this.audio.feature(this.renderer.frame), { present: false });
      this.renderer.present(); job.videoTrack.requestFrame();
      this.elapsed = time; this.percent = Math.min(100, Math.floor(time / job.duration * 100)); this.emit();
      if (time >= job.duration) {
        this.state = 'finishing'; this.message = '曲末を記録して、動画をまとめています…'; this.emit();
        this.holdFinal(job);
      } else this.schedule(job, () => this.pump(job));
    } catch (error) { this.fail(job, error.message || '動画の描画に失敗しました。'); }
  }
  async holdFinal(job) {
    await this.nextFrame(job); if (!this.active(job)) return;
    this.renderer.present(); job.videoTrack.requestFrame();
    await this.nextFrame(job); if (this.active(job)) this.finish(job, true);
  }
  cancel() { if (this.job && !this.job.finishing) this.fail(this.job, '録画を中止しました。途中の動画は保存していません。', true); }
  fail(job, reason, cancelled = false) {
    if (this.job !== job || this.disposed) return;
    job.reason = reason; job.cancelled = true; job.userCancelled = cancelled;
    if (!job.finishing) this.finish(job, false);
  }
  async finish(job, success) {
    if (!this.active(job)) return;
    job.finishing = true; this.state = 'finishing'; this.message = success ? '動画をまとめています…' : job.reason; this.emit();
    this.cancelFrames(job); this.clearTimers(job);
    try {
      if (job.recorder && job.recorder.state !== 'inactive') {
        job.recorder.stop();
        const stopped = await Promise.race([job.stopped.promise, new Promise(resolve => this.timer(job, () => resolve(false), 5000))]);
        if (!stopped) { success = false; job.reason = '録画の終了処理が完了しませんでした。もう一度お試しください。'; }
      }
      if (success && !job.cancelled && !this.disposed && this.job === job) {
        const blob = new Blob(job.chunks, { type: job.recorder.mimeType || this.support.mimeType });
        if (!blob.size) throw new Error('動画データが空でした。もう一度お試しください。');
        this.blob = blob; this.url = this.env.createURL(blob);
        this.info = { name: job.name, duration: job.duration, width: this.renderer.canvas.width, height: this.renderer.canvas.height,
          mimeType: blob.type, bytes: blob.size, finalFrame: this.renderer.frame };
      }
    } catch (error) { success = false; job.reason = error.message || '動画を保存できませんでした。'; this.clearResult(); }
    finally {
      this.release(job);
      if (this.job === job && !this.disposed) {
        this.state = 'restoring'; this.message = '制作画面を元の位置へ戻しています…'; this.emit();
        try {
          this.audio.setPosition(job.position); await this.studio.restore(false);
          if (this.audio.time !== job.position || this.renderer.frame !== frameCount(job.position, job.duration)) throw new Error('restore position');
        }
        catch {
          success = false; job.reason = '制作画面へ戻せませんでした。最初から再生してください。'; this.clearResult();
          this.studio.state = 'ready'; this.studio.progress = null;
        }
        if (this.job === job && !this.disposed) {
          this.studio.exporting = false; this.job = null;
          this.state = success && this.blob ? 'ready' : job.userCancelled ? 'idle' : 'error';
          this.message = success && this.blob ? '音声付きWebMが完成しました。保存できます。' : job.reason;
          this.emit();
        }
      }
      job.done.resolve(this.blob);
    }
  }

  listen(job, target, type, handler) {
    target.addEventListener(type, handler); job.cleanups.push(() => target.removeEventListener(type, handler));
  }
  timer(job, fn, ms) { const id = this.env.setTimer(() => { job.timers.delete(id); fn(); }, ms); job.timers.add(id); return id; }
  clearTimers(job) { job.timers.forEach(id => this.env.clearTimer(id)); job.timers.clear(); }
  schedule(job, fn) { const id = this.env.raf(() => { job.rafs.delete(id); fn(); }); job.rafs.add(id); }
  nextFrame(job) { return new Promise(resolve => { this.schedule(job, resolve); job.cleanups.push(resolve); }); }
  cancelFrames(job) { job.rafs.forEach(id => this.env.cancelRaf(id)); job.rafs.clear(); }
  release(job) {
    this.cancelFrames(job); this.clearTimers(job); job.cleanups.splice(0).forEach(fn => fn());
    if (job.recorder) job.recorder.onstart = job.recorder.onstop = job.recorder.onerror = job.recorder.ondataavailable = null;
    job.session?.stop(); job.videoStream?.getTracks().forEach(track => track.stop());
    job.stream?.getTracks().forEach(track => track.stop()); job.chunks = [];
  }
  dispose() {
    this.disposed = true; const job = this.job;
    if (job) {
      job.finishing = true; job.cancelled = true;
      if (job.recorder && job.recorder.state !== 'inactive') { try { job.recorder.stop(); } catch {} }
      this.release(job); job.done.resolve(null); this.job = null;
    }
    this.studio.exporting = false; this.clearResult();
  }
}
