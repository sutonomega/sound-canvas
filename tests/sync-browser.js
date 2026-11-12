import { AudioEngine } from '../dist/audio.js';
import { Renderer } from '../dist/renderer.js';
import { StudioController } from '../dist/controller.js';
import { VideoExporter } from '../dist/video.js';
import { frameCount } from '../dist/timing.js';
import { styleRegistry } from '../dist/styles/index.js';
import { decodeRecording, soundOnsets, imageMetrics } from './webm-inspect.js';
const $ = id => document.getElementById(id), pulses = [.2, 1.4, 2.7], duration = 3.113;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const copy = c => { const result = document.createElement('canvas'); result.width = c.width; result.height = c.height; result.getContext('2d').drawImage(c, 0, 0); return result; };
const pixels = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
const round = n => Math.round(n * 1000) / 1000;
const probe = { id: 'syncProbe', version: 'sync-probe-1', create() {
  let width, height, steps = 0;
  return { reset(options) { ({ width, height } = options); steps = 0; },
    step({ features, layers }) { steps++; layers.drawing.fillStyle = '#101010'; layers.drawing.fillRect(0, 0, width, height);
      if (features.beat) { layers.effects.fillStyle = '#ffffff'; layers.effects.fillRect(width / 4, height / 4, width / 2, height / 2); } },
    snapshot() { return { steps }; }, restore(state) { steps = state.steps; }, dispose() {} };
} };
let urls = [];
$('run').onclick = async () => {
  $('run').disabled = true; $('preview').replaceChildren(); $('results').replaceChildren(); $('report').textContent = '';
  $('save-report').hidden = $('save-image').hidden = true; urls.forEach(URL.revokeObjectURL); urls = [];
  const report = { environment: navigator.userAgent, duration, pulses, thresholds: { syncMs: 100, psnr: 30, foregroundPsnr: 20, foregroundRecall: .75, edgeMae: 8, referenceWindowFrames: 3 }, sync: [], quality: [], checks: [] };
  let total = 0, passed = 0; const proofs = [];
  const check = async (title, fn) => {
    total++; const li = document.createElement('li');
    try { await fn(); passed++; li.className = 'pass'; li.textContent = `PASS ${title}`; report.checks.push({ title, passed: true }); }
    catch (error) { li.className = 'fail'; li.textContent = `FAIL ${title}：${error.message}`; report.checks.push({ title, passed: false, error: error.message }); }
    $('results').append(li); $('summary').textContent = `確認中：${passed}/${total} 成功`;
  };
  const audio = new AudioEngine(), canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280; $('preview').append(canvas);
  const renderer = new Renderer(canvas, { styles: { ...styleRegistry, syncProbe: probe } });
  const studio = new StudioController(audio, renderer);
  const exporter = new VideoExporter(studio, () => $('progress').textContent = `${exporter.state} ${exporter.percent}% ${exporter.message}`);
  try {
    const context = audio.ensureContext(); await audio.init();
    const make = async baseline => {
      const rate = 16000, buffer = context.createBuffer(1, Math.round(duration * rate), rate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        if (baseline) data[i] = .025 * Math.sin(2 * Math.PI * 220 * t) + .015 * Math.sin(2 * Math.PI * 880 * t) + .012 * Math.sin(2 * Math.PI * 3100 * t) + .015 * Math.sin(2 * Math.PI * 70 * t);
        for (const start of pulses) {
          const age = t - start;
          if (age >= 0 && age < .1) data[i] += Math.min(1, age / .002) * (.3 * Math.sin(2 * Math.PI * 70 * age) + .25 * Math.sin(2 * Math.PI * 880 * age)) * Math.exp(-age * 8);
        }
      }
      return audio.analyze(buffer);
    };
    const marker = await make(false), music = await make(true);
    report.analysisVersion = marker.analysis.version;
    report.markerBeatFrames = marker.features.flatMap((feature, i) => feature.beat ? [i] : []);
    for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) await check(`同期マーカー / ${size.join('×')}：先頭・中間・終端付近`, async () => {
      renderer.configure({ style: 'syncProbe' }, size); await studio.load(async () => marker, 'sync-marker.wav');
      const blob = await exporter.start(); assert(blob, exporter.message);
      const sample = document.createElement('canvas'); sample.width = sample.height = 16; const c = sample.getContext('2d', { willReadFrequently: true });
      const flashes = []; let wasWhite = false;
      const decoded = await decodeRecording(blob, frame => {
        c.drawImage(frame, 0, 0, 16, 16); const rgba = c.getImageData(8, 8, 1, 1).data, white = rgba[0] > 180 && rgba[1] > 180 && rgba[2] > 180;
        if (white && !wasWhite) flashes.push(frame.timestamp / 1e6); wasWhite = white;
      });
      const sound = soundOnsets(decoded.sound); assert(sound.length === 3 && flashes.length === 3, `イベント数 音${sound.length} 映像${flashes.length}`);
      const differencesMs = flashes.map((time, i) => (time - sound[i]) * 1000);
      report.sync.push({ width: size[0], height: size[1], audioOnsets: sound.map(round), videoOnsets: flashes.map(round), differencesMs: differencesMs.map(round), bytes: blob.size });
      assert(differencesMs.every(value => Math.abs(value) <= 100), `同期差 ${differencesMs.map(round).join(', ')}ms`);
    });
    for (const style of Object.keys(styleRegistry)) for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) await check(`${style} / ${size.join('×')}：冒頭付近・中間・最終画面`, async () => {
      renderer.configure({ style, theme: 'aurora', strength: 1, trail: 'accumulate' }, size); await studio.load(async () => music, 'synthetic.wav');
      const blob = await exporter.start(); assert(blob, exporter.message);
      const draw = document.createElement('canvas'); [draw.width, draw.height] = size; const c = draw.getContext('2d', { willReadFrequently: true });
      const targets = [.5, 1.6], selected = targets.map(target => ({ target, distance: Infinity })); let last;
      const decoded = await decodeRecording(blob, frame => {
        const time = frame.timestamp / 1e6; let needed = time >= duration - .05;
        for (const slot of selected) if (time >= slot.target + .02 && Math.abs(time - (slot.target + .08)) < slot.distance) needed = true;
        if (!needed) return; c.drawImage(frame, 0, 0); const image = pixels(draw);
        for (const slot of selected) if (time >= slot.target + .02 && Math.abs(time - (slot.target + .08)) < slot.distance) {
          slot.distance = Math.abs(time - (slot.target + .08)); slot.time = time; slot.image = image;
        }
        if (time >= duration - .05) last = { time, image };
      });
      const sound = soundOnsets(decoded.sound); assert(sound.length === 3, `基準音数 ${sound.length}`);
      const origin = sound.reduce((sum, time, i) => sum + time - pulses[i], 0) / 3;
      const referenceCanvas = document.createElement('canvas'); [referenceCanvas.width, referenceCanvas.height] = size;
      const reference = new Renderer(referenceCanvas); reference.configure({ style, theme: 'aurora', strength: 1, trail: 'accumulate' });
      const metadata = { duration: music.buffer.duration, trackKey: music.analysis.trackKey, analysisVersion: music.analysis.version };
      reference.reset(music.seed, metadata); const background = pixels(referenceCanvas), samples = [];
      report.quality.push({ style, width: size[0], height: size[1], bytes: blob.size, audioOriginSeconds: round(origin), tracks: decoded.tracks, samples });
      try {
        for (const [index, slot] of [...selected, last].entries()) {
          assert(slot?.image, '検証する映像フレームが無い');
          const songTime = slot.time - origin, totalFrames = frameCount(duration, duration), expectedFrame = index === 2 ? totalFrames : frameCount(Math.max(0, songTime), duration);
          let best;
          const candidates = index === 2 ? [totalFrames] : Array.from({ length: 7 }, (_, i) => Math.max(0, Math.min(totalFrames, expectedFrame + i - 3)));
          for (const count of candidates) {
            reference.reset(music.seed, metadata); for (let i = 0; i < count; i++) reference.step(music.features[i], { present: false }); reference.present();
            const metrics = imageMetrics(pixels(referenceCanvas), slot.image, background, ...size);
            if (!best || metrics.foregroundPsnr > best.foregroundPsnr) best = { ...metrics, referenceFrame: count };
          }
          samples.push({ position: index === 2 ? 'end' : index === 0 ? 'early' : 'middle', encodedTime: round(slot.time), estimatedSongTime: round(songTime),
            referenceOffsetMs: round((best.referenceFrame - expectedFrame) / 30 * 1000), ...Object.fromEntries(Object.entries(best).map(([key, value]) => [key, round(value)])) });
          assert(best.foregroundPixels > 20, '参照画像に十分な描画が無い');
          assert(best.psnr >= 30 && best.foregroundPsnr >= 20 && best.foregroundRecall >= .75 && best.edgeMae <= 8,
            `画質 ${index} PSNR ${round(best.psnr)} 前景 ${round(best.foregroundPsnr)} 残存 ${round(best.foregroundRecall)}`);
          if (style === 'watercolor' && size[0] === 720) {
            reference.reset(music.seed, metadata); for (let i = 0; i < best.referenceFrame; i++) reference.step(music.features[i], { present: false }); reference.present();
            c.putImageData(new ImageData(slot.image, ...size), 0, 0); proofs.push({ position: samples.at(-1).position, reference: copy(referenceCanvas), decoded: copy(draw) });
          }
        }
      } finally { reference.dispose(); }
    });
    report.total = total; report.passed = passed;
    if (passed === total) {
      const sheet = document.createElement('canvas'); sheet.width = 1540; sheet.height = 2310; const c = sheet.getContext('2d');
      c.fillStyle = '#10131b'; c.fillRect(0, 0, sheet.width, sheet.height); c.fillStyle = '#eaf3ff'; c.font = '28px sans-serif';
      c.fillText('Sound Canvas / preview vs decoded WebM / watercolor / 9:16', 24, 42);
      proofs.forEach((proof, i) => { const y = 80 + i * 740; c.fillStyle = '#d5f5a0'; c.font = '22px sans-serif'; c.fillText(`${proof.position} / preview`, 24, y); c.fillText('decoded WebM', 790, y);
        c.drawImage(proof.reference, 100, y + 16, 360, 640); c.drawImage(proof.decoded, 860, y + 16, 360, 640); });
      $('preview').append(sheet);
      const png = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
      for (const [id, blob] of [['save-report', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })], ['save-image', png]]) {
        const url = URL.createObjectURL(blob); urls.push(url); $(id).href = url; $(id).hidden = false;
      }
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { exporter.dispose(); studio.cache.clear(); renderer.dispose(); await audio.context?.close(); $('run').disabled = false; }
};
