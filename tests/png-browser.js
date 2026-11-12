import { AudioEngine } from '../dist/audio.js';
import { Renderer } from '../dist/renderer.js';
import { StudioController } from '../dist/controller.js';
import { PngExporter } from '../dist/png.js';
import { frameCount } from '../dist/timing.js';
import { styleRegistry } from '../dist/styles/index.js';
const $ = id => document.getElementById(id), assert = (ok, message) => { if (!ok) throw new Error(message); };
const pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const copy = canvas => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; c.getContext('2d').drawImage(canvas, 0, 0); return c; };
let urls = [];
$('run').onclick = async () => {
  $('run').disabled = true; $('results').replaceChildren(); $('preview').replaceChildren();
  $('save').hidden = $('image').hidden = true; urls.forEach(URL.revokeObjectURL); urls = [];
  const report = { environment: navigator.userAgent, duration: 7.213, currentTime: 2.113, checks: [] }, proofs = [];
  const check = async (title, fn) => {
    const li = document.createElement('li');
    try { const details = await fn(); report.checks.push({ title, passed: true, ...details }); li.textContent = `PASS ${title}`; li.className = 'pass'; }
    catch (error) { report.checks.push({ title, passed: false, error: error.message }); li.textContent = `FAIL ${title}: ${error.message}`; li.className = 'fail'; }
    $('results').append(li); $('status').textContent = `${report.checks.length}件確認`;
  };
  const audio = new AudioEngine(), canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
  const renderer = new Renderer(canvas), studio = new StudioController(audio, renderer);
  const png = new PngExporter(studio);
  try {
    const context = audio.ensureContext(); await audio.init(); const rate = 8000;
    const buffer = context.createBuffer(1, Math.round(rate * report.duration), rate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) { const t = i / rate, pulse = Math.exp(-(t % .5) * 16);
      data[i] = pulse * .3 * Math.sin(2 * Math.PI * 70 * t) + .12 * Math.sin(2 * Math.PI * 330 * t) + .05 * Math.sin(2 * Math.PI * 2800 * t); }
    const track = await audio.analyze(buffer); await studio.load(async () => track, 'png-fixture.wav');
    for (const trail of ['accumulate', 'fade']) for (const style of Object.keys(styleRegistry)) for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) {
      await studio.configure({ style, theme: trail === 'fade' ? 'ocean' : 'aurora', strength: 1, trail }, size); await studio.seek(report.currentTime);
      const before = pixels(canvas), state = JSON.stringify(renderer.style.snapshot());
      for (const kind of ['current', 'complete']) await check(`${style} / ${size.join('×')} / ${trail} / ${kind}`, async () => {
        const blob = await png.start(kind); assert(blob?.type === 'image/png', png.message);
        const decoded = await createImageBitmap(blob);
        const actual = document.createElement('canvas'); actual.width = decoded.width; actual.height = decoded.height;
        actual.getContext('2d').drawImage(decoded, 0, 0); decoded.close();
        assert(actual.width === size[0] && actual.height === size[1], 'PNGサイズが異なる');
        const reference = document.createElement('canvas'); [reference.width, reference.height] = size; const ref = new Renderer(reference);
        try {
          ref.configure({ ...renderer.settings }); ref.reset(track.seed, renderer.metadata);
          const frames = frameCount(kind === 'current' ? report.currentTime : report.duration, report.duration);
          for (let i = 0; i < frames; i++) ref.step(track.features[i], { present: false }); ref.present();
          assert(same(pixels(reference), pixels(actual)), 'PNGの画素が参照画面と異なる');
          assert(same(before, pixels(canvas)) && state === JSON.stringify(renderer.style.snapshot()), 'プレビューが変わった');
          assert(audio.time === report.currentTime && !audio.playing && !studio.exporting, '再生位置・停止状態が異なる');
          assert(png.info.frame === frames, '出力フレームが異なる');
          if (style === 'organic' && size[0] === 720 && trail === 'accumulate') proofs.push({ kind, canvas: copy(actual) });
          return { width: actual.width, height: actual.height, frame: frames, bytes: blob.size, rgbaDifference: 0, previewUnchanged: true, position: audio.time };
        } finally { ref.dispose(); actual.width = actual.height = reference.width = reference.height = 0; }
      });
    }
    await check('途中で中止 → 部分PNGなし → 再生成成功', async () => {
      const before = pixels(canvas); png.notify = () => { if (png.state === 'rendering' && png.percent > 0) png.cancel(); };
      assert(await png.start('complete') === null && !png.url, '部分PNGが残った');
      assert(!studio.exporting && same(before, pixels(canvas)), '中止後の状態が異なる');
      png.notify = () => {}; assert(await png.start('complete'), '再生成できない');
      return { previewUnchanged: true, position: audio.time };
    });
    report.total = report.checks.length; report.passed = report.checks.filter(check => check.passed).length;
    const sheet = document.createElement('canvas'); sheet.width = 840; sheet.height = 820; const c = sheet.getContext('2d');
    c.fillStyle = '#10131b'; c.fillRect(0, 0, 840, 820); c.font = '22px sans-serif'; c.fillStyle = '#d5f5a0';
    c.fillText('Sound Canvas / PNG / organic / 9:16', 24, 36);
    proofs.forEach((proof, i) => { c.fillText(`${proof.kind} / ${i ? '7.213s' : '2.113s'}`, 24 + i * 420, 78); c.drawImage(proof.canvas, 24 + i * 420, 100, 360, 640); proof.canvas.width = proof.canvas.height = 0; });
    $('preview').append(sheet); const image = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
    for (const [id, blob] of [['save', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })], ['image', image]]) {
      const url = URL.createObjectURL(blob); urls.push(url); $(id).href = url; $(id).hidden = false;
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('status').textContent = `完了：${report.passed}/${report.total} 成功`;
  } catch (error) { $('status').textContent = `失敗：${error.message}`; }
  finally { png.dispose(); renderer.dispose(); studio.cache.clear(); await audio.context?.close(); $('run').disabled = false; }
};
