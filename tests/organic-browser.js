import { Renderer } from '../dist/renderer.js';
import { styleRegistry } from '../dist/styles/index.js';
import { analyzeAudio } from '../dist/analysis.js';
import { organicFixture, organicScenarios, organicStress } from './organic-fixtures.js';

const selectedStyle = new URLSearchParams(location.search).get('style') ?? 'organic';
if (!Object.hasOwn(styleRegistry, selectedStyle)) throw new Error('未対応のスタイルです');
const definition = styleRegistry[selectedStyle];
document.querySelector('h1').textContent = `${definition.label}：音の違いと長時間描画の確認`;
document.title = `Sound Canvas ${definition.label}の比較`;
document.getElementById('save-image').download = `${selectedStyle}-comparison.png`;
document.getElementById('save-report').download = `${selectedStyle}-metrics.json`;
const $ = id => document.getElementById(id), urls = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const image = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
const create = size => {
  const surface = document.createElement('canvas'); [surface.width, surface.height] = size;
  const renderer = new Renderer(surface); renderer.configure({ style: selectedStyle }); return renderer;
};
function equal(a, b) {
  assert(a.length === b.length, '画像サイズが異なる');
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `画素差 ${i}`);
}
function metrics(canvas, background) {
  const data = image(canvas), w = canvas.width, h = canvas.height;
  let changed = 0, white = 0, edgeChanged = 0, chromatic = 0;
  const border = Math.max(1, Math.floor(Math.min(w, h) * .02));
  for (let i = 0; i < data.length; i += 4) {
    const difference = Math.max(...[0, 1, 2].map(k => Math.abs(data[i + k] - background[i + k])));
    if (difference > 8) {
      changed++;
      const maximum = Math.max(data[i], data[i + 1], data[i + 2]);
      const minimum = Math.min(data[i], data[i + 1], data[i + 2]);
      if (maximum > 0 && (maximum - minimum) / maximum > .25) chromatic++;
    }
    if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) white++;
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    if ((x < border || y < border || x >= w - border || y >= h - border) && difference > 1) edgeChanged++;
  }
  return { width: w, height: h, changedPixels: changed, whitePixels: white,
    changedPercent: changed / (w * h) * 100, whitePercent: white / (w * h) * 100, edgeChangedPixels: edgeChanged, chromaticPercent: changed ? chromatic / changed * 100 : 0 };
}
async function render(r, start, end, features) {
  for (let frame = start; frame < end; frame++) {
    r.step(features(frame), { present: false });
    if (frame % 120 === 0) {
      $('summary').textContent = `描画中 ${frame + 1}/${end}`;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  r.present();
}
async function downloadable(id, blob) {
  const url = URL.createObjectURL(blob); urls.push(url); $(id).href = url; $(id).hidden = false;
}

$('run').onclick = async () => {
  $('run').disabled = true; $('save-image').hidden = $('save-report').hidden = true;
  urls.splice(0).forEach(url => URL.revokeObjectURL(url));
  $('gallery').replaceChildren(); $('results').replaceChildren(); $('report').textContent = '';
  let passed = 0, total = 0;
  const report = { environment: navigator.userAgent, fixture: { sampleRate: 22050, sectionSeconds: 18, totalSeconds: 54 },
    style: definition.version, theme: 'aurora', strength: 1, trail: 'accumulate', scenarios: [], bounds: [] };
  const check = async (title, operation) => {
    total++; const item = document.createElement('li');
    try { await operation(); passed++; item.className = 'pass'; item.textContent = `PASS ${title}`; }
    catch (error) { item.className = 'fail'; item.textContent = `FAIL ${title}: ${error.message}`; }
    $('results').append(item);
  };
  try {
    const analysis = await analyzeAudio(organicFixture(), { onProgress: text => { $('summary').textContent = text; } });
    report.analysisVersion = analysis.version; report.trackKey = analysis.trackKey; report.seed = analysis.seed;
    const outputs = [], segmentFrames = 18 * 30;
    for (let n = 0; n < organicScenarios.length; n++) {
      const scenario = organicScenarios[n], r = create([720, 1280]);
      const samples = analysis.frames.slice(n * segmentFrames, (n + 1) * segmentFrames);
      r.reset(analysis.seed, { duration: 18, trackKey: `${analysis.trackKey}:${scenario.id}`, analysisVersion: analysis.version });
      const background = image(r.canvas);
      await render(r, 0, segmentFrames, i => samples[i]);
      const stats = metrics(r.canvas, background);
      const mean = key => samples.reduce((sum, f) => sum + f[key], 0) / samples.length;
      report.scenarios.push({ id: scenario.id, seconds: [n * 18, (n + 1) * 18], ...stats,
        mean: Object.fromEntries(['volume', 'bass', 'mid', 'high', 'intensity'].map(key => [key, mean(key)])),
        beats: samples.filter(f => f.beat).length });
      await check(`${scenario.label}：描画・余白・曲末の保持`, () => {
        if (n === 0) equal(image(r.canvas), background);
        else assert(stats.changedPixels > 500, '描画がほとんど無い');
        assert(stats.edgeChangedPixels === 0, '外周に意図しない描画');
        assert(stats.whitePercent < .1, '白飛びが多い');
        const final = image(r.canvas), state = JSON.stringify(r.style.snapshot());
        assert(r.step(samples.at(-1)) === false, '終端後に進む'); equal(image(r.canvas), final);
        assert(JSON.stringify(r.style.snapshot()) === state, '終端状態が変わる');
      });
      const figure = document.createElement('figure'), caption = document.createElement('figcaption');
      caption.textContent = scenario.label; figure.append(r.canvas, caption); $('gallery').append(figure);
      outputs.push(r.canvas); r.dispose();
    }
    await check('穏やかな区間と強いビートで異なる作品になる', () => {
      const calm = report.scenarios[1], beat = report.scenarios[2];
      assert(beat.changedPixels > calm.changedPixels * 1.3, '描画密度の差が小さい');
      assert(beat.mean.intensity > calm.mean.intensity * 2, '盛り上がりの差が小さい');
    });
    for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) {
      await check(`${size.join('×')}：最大反応でも外周が欠けない`, async () => {
        const r = create(size); r.configure({ strength: 2 }); r.reset(analysis.seed, { duration: 6 });
        const background = image(r.canvas);
        await render(r, 0, 180, () => ({ volume: 1, bass: 1, mid: 1, high: 1, intensity: 1, beat: true }));
        const stats = metrics(r.canvas, background); report.bounds.push(stats);
        assert(stats.edgeChangedPixels === 0, '外周に描画がはみ出す'); r.dispose();
      });
    }
    await check('5分蓄積の白飛び・状態上限・曲末復元', async () => {
      const r = create([180, 320]); r.configure({ strength: 2 }); r.reset(analysis.seed, { duration: 300 });
      const background = image(r.canvas), started = performance.now();
      await render(r, 0, 8970, organicStress); const saved = r.snapshot();
      await render(r, 8970, 9000, organicStress);
      const expected = image(r.canvas), state = JSON.stringify(r.style.snapshot());
      const stats = metrics(r.canvas, background);
      report.long = { seconds: 300, frames: 9000, strength: 2, ...stats, elapsedMs: Math.round(performance.now() - started) };
      assert(stats.whitePercent < .1, '5分で白飛び'); assert(stats.edgeChangedPixels === 0, '5分で外周に描画');
      const transient = r.style.snapshot().pulses ?? r.style.snapshot().rings ?? r.style.snapshot().particles ?? r.style.snapshot().blooms;
      report.long.transientCount = transient.length;
      assert(transient.length <= definition.maxTransient, '演出が増え続ける');
      r.restore(saved); await render(r, 8970, 9000, organicStress); equal(image(r.canvas), expected);
      assert(JSON.stringify(r.style.snapshot()) === state, '曲末復元後の状態差'); r.dispose();
    });

    if (selectedStyle === 'watercolor') {
      report.longSettings = [];
      for (const theme of ['aurora', 'ember', 'ocean']) for (const trail of ['accumulate', 'fade']) {
        await check(`水彩5分 / ${theme} / ${trail}：色と余白を保つ`, async () => {
          const r = create([180, 320]); r.configure({ strength: 2, theme, trail });
          r.reset(analysis.seed, { duration: 300 }); const background = image(r.canvas);
          await render(r, 0, 9000, organicStress);
          const stats = metrics(r.canvas, background); report.longSettings.push({ theme, trail, ...stats });
          assert(stats.whitePercent < .1, '全面の白飛び');
          assert(stats.changedPercent > .1 && stats.changedPercent < 85, '描画が無いか全面が塗りつぶされた');
          assert(stats.chromaticPercent > 90, '色の彩度が失われた');
          assert(stats.edgeChangedPixels === 0, '外周に描画'); r.dispose();
        });
      }
    }

    const sheet = document.createElement('canvas'); sheet.width = 2288; sheet.height = 1460;
    const c = sheet.getContext('2d'); c.fillStyle = '#0d121b'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.fillStyle = '#eaf3ff'; c.font = '30px sans-serif'; c.fillText(`Sound Canvas / ${definition.label} / ${definition.version}`, 32, 42);
    c.fillStyle = '#a5b2c3'; c.font = '20px sans-serif';
    c.fillText('同じシード・共通の正規化基準 / 各18秒 / Aurora / 9:16 / 蓄積', 32, 76);
    outputs.forEach((canvas, i) => {
      c.fillStyle = '#d5f5a0'; c.font = '24px sans-serif'; c.fillText(organicScenarios[i].label, 32 + i * 752, 113);
      c.drawImage(canvas, 32 + i * 752, 132);
    });
    if (passed === total) {
      await downloadable('save-image', await new Promise(resolve => sheet.toBlob(resolve, 'image/png')));
      await downloadable('save-report', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    }
    $('report').textContent = JSON.stringify(report, null, 2);
    $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { $('run').disabled = false; }
};
