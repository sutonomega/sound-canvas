import { AudioEngine } from '../dist/audio.js';
import { analyzeAudio } from '../dist/analysis.js';
import { Renderer, RENDER_VERSION } from '../dist/renderer.js';
import { StudioController } from '../dist/controller.js';
import { CACHE_LIMIT_BYTES, CACHE_ENTRY_LIMIT, CHECKPOINT_FRAMES } from '../dist/checkpoints.js';
import { frameCount } from '../dist/timing.js';
import { styleRegistry } from '../dist/styles/index.js';
import { reproducibilityFixture } from './reproducibility-fixture.js';
const $ = id => document.getElementById(id);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const create = size => { const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = size; return new Renderer(canvas); };
const pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
const equal = (a, b, label) => { assert(a.length === b.length, label); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${label} 画素差 ${i}`); };
const compare = (a, b) => {
  equal(pixels(a.canvas), pixels(b.canvas), '合成');
  for (const layer of ['background', 'drawing', 'effects']) equal(pixels(a.layers[layer].canvas), pixels(b.layers[layer].canvas), layer);
  assert(JSON.stringify(a.style.snapshot()) === JSON.stringify(b.style.snapshot()), '状態・乱数');
};
const metadata = track => ({ duration: track.buffer.duration, trackKey: track.analysis.trackKey, analysisVersion: track.analysis.version });
function fixture(size, yieldTask = wait) {
  const audio = new AudioEngine(); audio.context = { currentTime: 0, resume: async () => {}, destination: {},
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }) };
  const renderer = create(size), reference = create(size);
  const studio = new StudioController(audio, renderer, () => {
    if (studio.progress) $('progress').textContent = `${studio.progress.targetTime.toFixed(1)}秒へ移動中 ${studio.progress.percent}%`;
  }, yieldTask);
  return { audio, renderer, reference, studio, dispose() { studio.cache.clear(); renderer.dispose(); reference.dispose(); } };
}
// Matches the previous controller's cold replay: reset, one feature per step, yield every 240 frames.
async function coldReplay(r, time, track) {
  const start = performance.now(); r.reset(track.seed, metadata(track));
  const target = frameCount(time, track.buffer.duration);
  for (let frame = 0; frame < target; frame++) {
    r.step(track.features[frame], { present: false });
    if (frame % 240 === 0) { r.present(); await wait(); }
  }
  r.present(); return performance.now() - start;
}
const round = n => Math.round(n * 100) / 100;
let urls = [];
$('run').onclick = async () => {
  $('run').disabled = true; $('gallery').replaceChildren(); $('results').replaceChildren(); $('report').textContent = '';
  $('save-image').hidden = $('save-report').hidden = true; urls.forEach(URL.revokeObjectURL); urls = [];
  let total = 0, passed = 0;
  const report = { environment: navigator.userAgent, rendererVersion: RENDER_VERSION,
    policy: { maxBytes: CACHE_LIMIT_BYTES, maxEntries: CACHE_ENTRY_LIMIT, intervalFrames: CHECKPOINT_FRAMES, sliceBudgetMs: 8, sliceMaxFrames: 120 },
    memoryNote: 'Retained snapshot RGBA bytes plus UTF-16 state estimate; excludes audio, active surfaces, temporary copies and browser/GPU overhead.',
    analysis: [], benchmarks: [], checks: [] };
  const check = async (title, operation) => {
    total++; const item = document.createElement('li');
    try { await operation(); passed++; item.className = 'pass'; item.textContent = `PASS ${title}`; report.checks.push({ title, passed: true }); }
    catch (error) { item.className = 'fail'; item.textContent = `FAIL ${title}：${error.message}`; report.checks.push({ title, passed: false, error: error.message }); }
    $('results').append(item); $('summary').textContent = `確認中：${passed}/${total} 成功`;
    await new Promise(requestAnimationFrame);
  };
  try {
    const tracks = {};
    for (const seconds of [180, 300]) {
      const started = performance.now(), buffer = reproducibilityFixture(8000, seconds * 8000);
      const analysis = await analyzeAudio(buffer, { onProgress: message => $('progress').textContent = `${seconds}秒 / ${message}` });
      tracks[seconds] = { buffer, analysis, features: analysis.frames, seed: analysis.seed };
      report.analysis.push({ seconds, sampleRate: 8000, channels: 2, samples: buffer.length, featureFrames: analysis.frames.length,
        analysisMs: round(performance.now() - started), trackKey: analysis.trackKey, seed: analysis.seed, analysisVersion: analysis.version });
    }
    const proofs = {};
    const cases = Object.keys(styleRegistry).flatMap(style => [180, 300].map(seconds => ({ style, seconds, size: [720, 1280] })));
    cases.push({ style: 'watercolor', seconds: 300, size: [1280, 720] }, { style: 'watercolor', seconds: 300, size: [1080, 1080] });
    for (const { style, seconds, size } of cases) await check(`${style} / ${seconds}秒 / ${size.join('×')}：冷間・再訪・画素・保持上限`, async () => {
      const f = fixture(size), track = tracks[seconds], settings = { style, theme: 'aurora', trail: 'accumulate', strength: 1 };
      try {
        f.renderer.configure(settings); f.reference.configure(settings); await f.studio.load(async () => track, 'synthetic.wav');
        const coldTarget = seconds - 1, warmTarget = seconds - 2;
        const baselineColdMs = await coldReplay(f.reference, coldTarget, track);
        await f.studio.seek(coldTarget); compare(f.renderer, f.reference); const cold = { ...f.studio.lastRestore };
        const baselineWarmTargetMs = await coldReplay(f.reference, warmTarget, track);
        await f.studio.seek(warmTarget); compare(f.renderer, f.reference); const warm = { ...f.studio.lastRestore }, cache = f.studio.cache.stats;
        assert(warm.cacheHit && warm.framesComputed < frameCount(warmTarget, seconds) * .2, '再訪の計算量が減っていない');
        assert(cache.bytes <= CACHE_LIMIT_BYTES && cache.entries <= CACHE_ENTRY_LIMIT, '保持上限を超えた');
        const baselineFrames = frameCount(warmTarget, seconds);
        report.benchmarks.push({ style, seconds, width: size[0], height: size[1], theme: 'aurora', trail: 'accumulate', strength: 1,
          coldTarget, warmTarget, baselineColdMs: round(baselineColdMs), optimizedColdMs: round(cold.elapsedMs),
          baselineWarmTargetMs: round(baselineWarmTargetMs), optimizedWarmMs: round(warm.elapsedMs),
          baselineFrames, warmStartFrame: warm.startFrame, warmFrames: warm.framesComputed,
          framesAvoidedPercent: round((1 - warm.framesComputed / baselineFrames) * 100),
          warmSpeedup: round(baselineWarmTargetMs / warm.elapsedMs), estimatedRetainedMiB: round(cache.bytes / 1048576),
          cacheEntries: cache.entries, cacheBytes: cache.bytes, maxChannelDifference: 0 });
        if (style === 'watercolor' && seconds === 300 && size[0] === 720) {
          for (const [mode, r] of [['baseline', f.reference], ['cached', f.renderer]]) {
            const c = document.createElement('canvas'); c.width = 720; c.height = 1280; c.getContext('2d').drawImage(r.canvas, 0, 0); proofs[mode] = c;
          }
        }
      } finally { f.dispose(); }
    });
    for (const style of Object.keys(styleRegistry)) await check(`${style}：再生中に保存した状態からの後方シーク`, async () => {
      const f = fixture([90, 160]), track = tracks[180];
      try {
        f.renderer.configure({ style }); f.reference.configure({ style }); await f.studio.load(async () => track, 'synthetic.wav');
        await f.studio.togglePlay(); f.audio.context.currentTime = 20; while (f.renderer.frame < f.studio.target) f.studio.tick();
        await f.studio.seek(16); await coldReplay(f.reference, 16, track); compare(f.renderer, f.reference);
        assert(f.studio.lastRestore.startFrame === 450 && f.studio.lastRestore.framesComputed === 30 && f.audio.playing, '再生中の保存状態の利用');
      } finally { f.dispose(); }
    });
    await check('復元中の連続シーク・設定変更・曲差替えは最後の要求だけを反映', async () => {
      const f = fixture([90, 160]);
      try {
        await f.studio.load(async () => tracks[180], 'first'); const hold = gate(); f.studio.yieldTask = () => hold.promise;
        const work = [f.studio.seek(179), f.studio.seek(100), f.studio.configure({ style: 'watercolor', theme: 'ember', strength: 2, trail: 'fade' }, [128, 128])];
        await f.studio.load(async () => tracks[300], 'last'); hold.resolve(); await Promise.all(work); f.studio.yieldTask = wait;
        await f.studio.seek(4.1); f.reference.configure(f.renderer.settings, [128, 128]); await coldReplay(f.reference, 4.1, tracks[300]); compare(f.renderer, f.reference);
        assert(f.studio.name === 'last' && f.audio.seed === tracks[300].seed && f.renderer.frame === 123, '古い結果が残る');
      } finally { f.dispose(); }
    });
    await check('中止は最初の停止画面へ戻り、後で古い復元が再開しない', async () => {
      const f = fixture([90, 160]);
      try {
        await f.studio.load(async () => tracks[300], 'track'); const hold = gate(); f.studio.yieldTask = () => hold.promise;
        const work = f.studio.seek(299); assert(f.studio.restoring && !f.studio.canSave, '復元中の保存');
        f.studio.cancelRestore(); hold.resolve(); await work;
        f.reference.reset(f.audio.seed, metadata(tracks[300])); compare(f.renderer, f.reference);
        assert(f.audio.time === 0 && !f.audio.playing && f.studio.progress === null && f.studio.canSave, '中止後の状態');
      } finally { f.dispose(); }
    });
    await check('設定・比率・曲の変更で以前の保存面を解放する', async () => {
      const f = fixture([90, 160]);
      try {
        await f.studio.load(async () => tracks[180], 'track'); await f.studio.seek(20);
        const previous = f.studio.cache.entries.map(e => e.snapshot), hold = gate(); f.studio.yieldTask = () => hold.promise;
        const work = f.studio.configure({ theme: 'ember' }, [128, 128]);
        assert(f.studio.cache.stats.entries === 0 && previous.every(s => s.layers.drawing.width === 0), '設定変更時の解放');
        hold.resolve(); await work;
        const older = f.studio.cache.entries.map(e => e.snapshot); await f.studio.load(async () => tracks[300], 'replacement');
        assert(f.studio.cache.stats.entries === 0 && older.every(s => s.layers.effects.width === 0), '曲変更時の解放');
      } finally { f.dispose(); }
    });
    await check('不正な保存状態は破棄して冒頭から同じ結果を作る', async () => {
      const f = fixture([90, 160]);
      try {
        await f.studio.load(async () => tracks[180], 'track'); await f.studio.seek(179);
        const saved = f.studio.cache.entries.find(e => e.snapshot.frame === 4950).snapshot; saved.styleState.randomState = NaN;
        await f.studio.seek(178); await coldReplay(f.reference, 178, tracks[180]); compare(f.renderer, f.reference);
        assert(f.studio.lastRestore.startFrame === 0 && !f.studio.lastRestore.cacheHit, '冒頭へのフォールバック');
      } finally { f.dispose(); }
    });
    report.total = total; report.passed = passed;
    if (passed === total) {
      const sheet = document.createElement('canvas'); sheet.width = 1540; sheet.height = 1470;
      const c = sheet.getContext('2d'); c.fillStyle = '#10131b'; c.fillRect(0, 0, sheet.width, sheet.height);
      c.fillStyle = '#eaf3ff'; c.font = '28px sans-serif'; c.fillText('Sound Canvas / 5 minute PCM / seek to 4:58', 30, 42);
      c.font = '20px sans-serif'; c.fillStyle = '#a5b2c3'; c.fillText('Watercolor / Aurora / 9:16 / 100% / accumulate / max pixel difference = 0', 30, 78);
      [['baseline', '冒頭から再計算'], ['cached', '保存状態から復元']].forEach(([mode, title], i) => {
        c.fillStyle = '#d5f5a0'; c.fillText(title, 30 + i * 760, 120); c.drawImage(proofs[mode], 30 + i * 760, 142);
      });
      $('gallery').append(sheet); const image = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
      for (const [id, blob] of [['save-image', image], ['save-report', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })]]) {
        const url = URL.createObjectURL(blob); urls.push(url); $(id).href = url; $(id).hidden = false;
      }
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('progress').textContent = '';
    $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { $('run').disabled = false; }
};
