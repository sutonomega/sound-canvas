import { AudioEngine } from '../dist/audio.js';
import { analyzeAudio } from '../dist/analysis.js';
import { Renderer, RENDER_VERSION } from '../dist/renderer.js';
import { StudioController } from '../dist/controller.js';
import { frameCount, TICK_EPSILON } from '../dist/timing.js';
import { styleRegistry } from '../dist/styles/index.js';
import { reproducibilityFixture } from './reproducibility-fixture.js';
const $ = id => document.getElementById(id);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const create = size => { const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = size; return new Renderer(canvas); };
const copy = canvas => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; c.getContext('2d').drawImage(canvas, 0, 0); return c; };
const pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const metadata = track => ({ duration: track.buffer.duration, trackKey: track.analysis.trackKey, analysisVersion: track.analysis.version });
const renderTo = (r, time, track) => { const end = frameCount(time, track.buffer.duration); while (r.frame < end) r.step(track.features[r.frame], { present: false }); r.present(); };
function fixture(size) {
  const audio = new AudioEngine(); audio.context = { currentTime: 0, resume: async () => {}, destination: {},
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }) };
  const renderer = create(size), reference = create(size);
  const studio = new StudioController(audio, renderer, () => {}, async () => {});
  return { audio, renderer, reference, studio, dispose() { studio.cache.clear(); renderer.dispose(); reference.dispose(); } };
}
let urls = [];
$('run').onclick = async () => {
  $('run').disabled = true; $('results').replaceChildren(); $('gallery').replaceChildren(); $('report').textContent = '';
  $('save-image').hidden = $('save-report').hidden = true; urls.forEach(URL.revokeObjectURL); urls = [];
  let total = 0, passed = 0, comparisons = 0;
  const report = { environment: navigator.userAgent, rendererVersion: RENDER_VERSION,
    pixelTolerance: 0, stateTolerance: 0, timeBoundaryToleranceTicks: TICK_EPSILON, matrix: [], fullSize: [], alignedEnd: [], proofs: [] };
  const check = async (title, operation) => {
    total++; const item = document.createElement('li');
    try { await operation(); passed++; item.className = 'pass'; item.textContent = `PASS ${title}`; }
    catch (error) { item.className = 'fail'; item.textContent = `FAIL ${title}：${error.message}`; }
    $('results').append(item); $('summary').textContent = `確認中：${passed}/${total} 成功`;
    await new Promise(requestAnimationFrame);
  };
  const equal = (a, b, label) => {
    assert(a.length === b.length, `${label}：画像サイズ`);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${label}：画素差 ${i}: ${a[i]} / ${b[i]}`);
  };
  const compare = (actual, reference, phase) => {
    assert(actual.frame === reference.frame, `${phase}：フレーム数`);
    assert(JSON.stringify(actual.style.snapshot()) === JSON.stringify(reference.style.snapshot()), `${phase}：状態・乱数`);
    equal(pixels(actual.canvas), pixels(reference.canvas), `${phase}/合成`);
    for (const layer of ['background', 'drawing', 'effects']) equal(pixels(actual.layers[layer].canvas), pixels(reference.layers[layer].canvas), `${phase}/${layer}`);
    comparisons++;
  };
  try {
    const buffer = reproducibilityFixture(), analysis = await analyzeAudio(buffer);
    const repeatedBuffer = reproducibilityFixture(), repeated = await analyzeAudio(repeatedBuffer, { yieldTask: async () => {} });
    const track = { buffer, analysis, features: analysis.frames, seed: analysis.seed };
    const repeatedTrack = { buffer: repeatedBuffer, analysis: repeated, features: repeated.frames, seed: repeated.seed };
    report.fixture = { sampleRate: buffer.sampleRate, channels: 2, samples: buffer.length, seconds: buffer.duration,
      featureFrames: analysis.frames.length, analysisVersion: analysis.version, trackKey: analysis.trackKey, seed: analysis.seed };
    await check('同じPCMの再解析で識別・シード・特徴列が一致する', () => {
      assert(analysis.trackKey === repeated.trackKey && analysis.seed === repeated.seed, '識別・シード');
      assert(JSON.stringify(analysis.frames) === JSON.stringify(repeated.frames), '特徴列');
      assert(analysis.frames.length === frameCount(buffer.duration, buffer.duration), '共通の曲末');
    });
    const proofs = {};
    async function scenario(settings, size, full = false) {
      const f = fixture(size), { audio, renderer: r, reference: ref, studio } = f;
      const startComparisons = comparisons;
      try {
        r.configure(settings); ref.configure(settings); await studio.load(async () => track, 'original.wav');
        ref.reset(track.seed, metadata(track)); compare(r, ref, '0秒');
        await studio.togglePlay();
        for (const time of [31 / 30, 4.1, 8.417, buffer.duration - .001, buffer.duration]) {
          audio.context.currentTime = time;
          let ticks = 0;
          do {
            studio.tick(); ticks++;
            assert(ticks < 10, '追いつきが終わらない');
          } while (r.frame !== studio.target);
          renderTo(ref, time, track); compare(r, ref, `順再生 ${time}`);
          assert(studio.canSave, '追いつき後の保存可否');
        }
        const expected = pixels(ref.canvas), finalState = JSON.stringify(ref.style.snapshot());
        for (let i = 0; i < 3; i++) studio.tick();
        equal(pixels(r.canvas), expected, '終端保持'); assert(JSON.stringify(r.style.snapshot()) === finalState, '終端状態');
        const proof = full && size[0] === 720 ? { sequential: copy(ref.canvas) } : null;

        // A single large time jump must catch up in bounded batches, without dropping simulation ticks.
        studio.restart(); await studio.togglePlay(); audio.context.currentTime += buffer.duration;
        let ticks = 0;
        while (r.frame !== studio.target) {
          studio.tick(); ticks++;
          if (r.frame !== studio.target) assert(!studio.canSave, '遅延中に保存可能');
          assert(ticks < 10, '遅延の追いつきが終わらない');
        }
        assert(ticks >= 4, '90ステップ上限を通っていない'); compare(r, ref, '大幅な描画遅延');
        if (proof) proof.delayed = copy(r.canvas);

        // Pause freezes drawing even when the audio clock advances; continuing uses the same feature order.
        studio.restart(); await studio.togglePlay(); audio.context.currentTime += 4.1;
        while (r.frame !== studio.target) studio.tick(); await studio.togglePlay();
        ref.reset(track.seed, metadata(track)); renderTo(ref, 4.1, track); compare(r, ref, '停止位置');
        const paused = pixels(r.canvas), pausedState = JSON.stringify(r.style.snapshot());
        audio.context.currentTime += 11; studio.tick(); equal(pixels(r.canvas), paused, '停止中');
        assert(JSON.stringify(r.style.snapshot()) === pausedState, '停止中の状態');
        await studio.togglePlay(); audio.context.currentTime += buffer.duration - audio.offset + .001;
        while (r.frame !== studio.target) studio.tick();
        renderTo(ref, buffer.duration, track); compare(r, ref, '停止後の再開');

        for (const time of [8.417, 31 / 30, 4.1, 0, buffer.duration]) {
          await studio.seek(time); ref.reset(track.seed, metadata(track)); renderTo(ref, time, track); compare(r, ref, `逆向き含むシーク ${time}`);
        }
        if (proof) proof.seek = copy(r.canvas);
        const midFrame = frameCount(4.1, buffer.duration);
        ref.reset(track.seed, metadata(track)); renderTo(ref, 4.1, track); const saved = ref.snapshot();
        renderTo(ref, buffer.duration, track); r.restore(saved); renderTo(r, buffer.duration, track); compare(r, ref, 'スナップショットから曲末');
        assert(saved.frame === midFrame, '境界の保存フレーム');

        await studio.configure({ theme: settings.theme === 'ember' ? 'ocean' : 'ember', strength: settings.strength === 2 ? .25 : 2 });
        await studio.configure(settings); compare(r, ref, '設定を戻す');
        await studio.load(async () => repeatedTrack, 'renamed.wav'); await studio.seek(buffer.duration); compare(r, ref, '別名で再読込');
        const rgbaSha256 = await digest(pixels(r.canvas));
        const entry = { ...settings, width: size[0], height: size[1], frame: r.frame, rgbaSha256,
          stateSha256: await digest(new TextEncoder().encode(JSON.stringify(r.style.snapshot()))), comparisons: comparisons - startComparisons,
          maxChannelDifference: 0 };
        if (proof) {
          proofs[settings.style] = proof;
          report.proofs.push({ style: settings.style, theme: settings.theme, strength: settings.strength, trail: settings.trail,
            width: size[0], height: size[1], seconds: buffer.duration, rgbaSha256 });
        }
        return entry;
      } finally { f.dispose(); }
    }
    for (const style of Object.keys(styleRegistry)) for (const theme of ['aurora', 'ember', 'ocean'])
      for (const trail of ['accumulate', 'fade']) for (const [i, size] of [[90, 160], [160, 90], [128, 128]].entries()) {
        await check(`${style} / ${theme} / ${trail} / ${size.join('×')}：時刻・停止・遅延・復元`, async () => {
          report.matrix.push(await scenario({ style, theme, trail, strength: [.25, 1, 2][i] }, size));
        });
      }
    for (const style of Object.keys(styleRegistry)) for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) {
      await check(`${style} / ${size.join('×')}：実出力サイズの再現性`, async () => {
        report.fullSize.push(await scenario({ style, theme: 'aurora', trail: 'accumulate', strength: 1 }, size, true));
      });
    }
    const alignedBuffer = reproducibilityFixture(48000, 49600), alignedAnalysis = await analyzeAudio(alignedBuffer);
    const aligned = { buffer: alignedBuffer, analysis: alignedAnalysis, features: alignedAnalysis.frames, seed: alignedAnalysis.seed };
    for (const style of Object.keys(styleRegistry)) await check(`${style}：31/30秒の曲末で空の32コマ目を作らない`, async () => {
      const f = fixture([90, 160]);
      try {
        f.renderer.configure({ style, trail: 'fade' }); f.reference.configure({ style, trail: 'fade' });
        await f.studio.load(async () => aligned, 'aligned.wav'); await f.studio.seek(alignedBuffer.duration);
        f.reference.reset(aligned.seed, metadata(aligned)); renderTo(f.reference, alignedBuffer.duration, aligned);
        assert(aligned.features.length === 31 && f.renderer.frame === 31, '曲末フレーム数'); compare(f.renderer, f.reference, '境界の曲末');
        assert(f.renderer.step(aligned.features.at(-1)) === false, '余分なステップ');
        report.alignedEnd.push({ style, frames: f.renderer.frame, rgbaSha256: await digest(pixels(f.renderer.canvas)) });
      } finally { f.dispose(); }
    });
    await check('版・曲・設定・解像度が異なる保存状態を拒否する', async () => {
      const r = create([90, 160]);
      try {
        r.reset(track.seed, metadata(track)); renderTo(r, 4.1, track); const saved = r.snapshot(), expected = pixels(r.canvas), state = JSON.stringify(r.style.snapshot());
        for (const change of [key => key.renderer = 'sc-renderer-3', key => key.styleVersion = 'other', key => key.seed++,
          key => key.metadata.trackKey = 'other', key => key.metadata.analysisVersion = 'old', key => key.metadata.duration++,
          key => key.settings.style = 'watercolor', key => key.settings.theme = 'ember', key => key.settings.strength = 2,
          key => key.settings.trail = 'fade', key => key.width++]) {
          const key = JSON.parse(saved.key); change(key); let rejected = false;
          try { r.restore({ ...saved, key: JSON.stringify(key) }); } catch { rejected = true; }
          assert(rejected, '異なるキーを受け入れた'); equal(pixels(r.canvas), expected, '拒否時の画面');
          assert(JSON.stringify(r.style.snapshot()) === state, '拒否時の状態');
        }
      } finally { r.dispose(); }
    });
    report.total = total; report.passed = passed; report.comparisons = comparisons;
    if (passed === total) {
      const sheet = document.createElement('canvas'); sheet.width = 1120; sheet.height = 1550;
      const c = sheet.getContext('2d'); c.fillStyle = '#10131b'; c.fillRect(0, 0, sheet.width, sheet.height);
      c.fillStyle = '#eaf3ff'; c.font = '28px sans-serif'; c.fillText('Sound Canvas / reproducibility / max pixel difference = 0', 24, 40);
      c.font = '18px sans-serif'; c.fillStyle = '#a5b2c3'; c.fillText(`Same PCM / ${buffer.duration}s / Aurora / 100% / 9:16 / accumulate`, 24, 70);
      const modes = [['sequential', '順再生'], ['delayed', '描画遅延からの追いつき'], ['seek', 'シーク後']];
      for (const [row, [mode, label]] of modes.entries()) {
        const y = 100 + row * 480; c.fillStyle = '#d5f5a0'; c.font = '20px sans-serif'; c.fillText(label, 24, y);
        Object.keys(styleRegistry).forEach((style, col) => {
          const x = 24 + col * 274; c.fillStyle = '#a5b2c3'; c.font = '16px sans-serif'; c.fillText(styleRegistry[style].label, x, y + 26);
          c.drawImage(proofs[style][mode], x, y + 36, 240, 427);
        });
      }
      $('gallery').append(sheet);
      const blob = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
      for (const [id, data] of [['save-image', blob], ['save-report', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })]]) {
        const url = URL.createObjectURL(data); urls.push(url); $(id).href = url; $(id).hidden = false;
      }
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { $('run').disabled = false; }
};
