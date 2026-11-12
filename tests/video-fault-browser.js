import { AudioEngine } from '../dist/audio.js';
import { Renderer } from '../dist/renderer.js';
import { StudioController } from '../dist/controller.js';
import { VideoExporter } from '../dist/video.js';
const $ = id => document.getElementById(id), results = [], visibilityEvents = [];
let url;
document.addEventListener('visibilitychange', () => { visibilityEvents.push({ state: document.visibilityState, time: performance.now() }); $('visibility').textContent = document.visibilityState; });
async function run(kind) {
  visibilityEvents.length = 0;
  $('hide').disabled = $('lag').disabled = true; $('preview').replaceChildren(); $('status').textContent = '準備中…';
  const audio = new AudioEngine(), canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280; $('preview').append(canvas);
  const renderer = new Renderer(canvas), studio = new StudioController(audio, renderer);
  const exporter = new VideoExporter(studio, () => $('status').textContent = `${exporter.state} ${exporter.percent}% ${exporter.message}`);
  let injected = false, timer;
  try {
    await audio.init(); const rate = 8000, duration = kind === 'hidden' ? 60 : 15;
    const buffer = audio.context.createBuffer(1, rate * duration, rate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = .3 * Math.sin(2 * Math.PI * 70 * i / rate) + .12 * Math.sin(2 * Math.PI * 330 * i / rate);
    const track = await audio.analyze(buffer); await studio.load(async () => track, 'fault-fixture.wav'); await studio.seek(1.1);
    if (kind === 'lag') timer = setInterval(() => {
      if (!injected && exporter.state === 'recording' && exporter.elapsed > .4) {
        injected = true; const end = performance.now() + 450; while (performance.now() < end) { /* Deliberate main-thread stall in the test only. */ }
      }
    }, 20);
    const done = exporter.start(), job = exporter.job; const blob = await done;
    const result = { kind, passed: !blob && !exporter.url && exporter.state === 'error' && audio.time === 1.1 && !audio.playing && !studio.exporting
        && (kind === 'lag' ? exporter.message.includes('追いつか') : exporter.message.includes('非表示')),
      message: exporter.message, state: exporter.state, blobBytes: blob?.size ?? 0, restoredTime: audio.time, canSave: studio.canSave,
      tracksReleased: job.stream?.getTracks().every(t => t.readyState === 'ended') ?? true,
      handlersReleased: job.rafs.size === 0 && job.timers.size === 0, injected, visibilityEvents: [...visibilityEvents] };
    await studio.togglePlay(); result.normalPlayAfterFailure = audio.playing; await studio.togglePlay(); result.passed &&= result.normalPlayAfterFailure;
    result.applied = kind === 'lag' ? injected : visibilityEvents.some(event => event.state === 'hidden');
    result.passed &&= result.tracksReleased && result.handlersReleased;
    if (!result.applied) result.passed = null;
    results.push(result); $('status').textContent = !result.applied ? '未検証：試験条件が発生しませんでした。自動操作中は非表示が通知されない場合があります。' : result.passed ? '成功：途中動画を破棄し、元の位置へ復帰しました。' : `失敗：${exporter.message}`;
  } catch (error) { results.push({ kind, passed: false, error: error.message }); $('status').textContent = error.message; }
  finally {
    clearInterval(timer); exporter.dispose(); studio.cache.clear(); renderer.dispose(); await audio.context?.close(); $('hide').disabled = $('lag').disabled = false;
    const report = { environment: navigator.userAgent, results }; $('report').textContent = JSON.stringify(report, null, 2);
    if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); $('save').href = url; $('save').hidden = false;
  }
}
$('hide').onclick = () => run('hidden'); $('lag').onclick = () => run('lag');
