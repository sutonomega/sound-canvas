import { AudioEngine } from '../dist/audio.js';
import { StudioController } from '../dist/controller.js';
import { Renderer } from '../dist/renderer.js';
import { PngExporter } from '../dist/png.js';
import { VideoExporter } from '../dist/video.js';
import { frameCount } from '../dist/timing.js';
import { demuxWebM } from './webm-inspect.js';
const $ = id => document.getElementById(id), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); }, round = n => Math.round(n * 1000) / 1000;
const report = { environment: navigator.userAgent, checks: [] }; let reportURL;
const localSession = new URLSearchParams(location.search).get('session');
function saveReport() {
  $('report').textContent = JSON.stringify(report, null, 2);
  if (reportURL) URL.revokeObjectURL(reportURL);
  reportURL = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  $('save').href = reportURL; $('save').hidden = false;
  // Optional loopback-only developer gateway persists anonymous results across browser interruptions.
  if (localSession && location.hostname === '127.0.0.1') fetch(`/local-report/${encodeURIComponent(localSession)}.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
  }).catch(() => {});
}
async function check(title, fn) {
  const item = document.createElement('li'); $('results').append(item); item.textContent = `RUN ${title}`;
  const entry = { title, passed: null }; report.checks.push(entry);
  try { const detail = await fn(entry); Object.assign(entry, { passed: true }, detail); item.textContent = `PASS ${title}`; item.className = 'pass'; }
  catch (error) { Object.assign(entry, { passed: false, error: error.message }); item.textContent = `FAIL ${title}: ${error.message}`; item.className = 'fail'; }
  saveReport();
}
function session() {
  const audio = new AudioEngine(), canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280; $('preview').replaceChildren(canvas);
  const renderer = new Renderer(canvas), studio = new StudioController(audio, renderer, () => $('status').textContent = studio.status);
  const png = new PngExporter(studio, () => $('status').textContent = `PNG ${png.percent}%`);
  const video = new VideoExporter(studio, () => $('status').textContent = `WebM ${video.state} ${video.percent}% / ${round(video.elapsed)}秒`);
  const tick = setInterval(() => studio.tick(), 16);
  return { audio, renderer, studio, png, video, async dispose() { clearInterval(tick); png.dispose(); video.dispose(); studio.cache.clear(); renderer.dispose(); await audio.context?.close(); } };
}
async function pngInfo(png, kind) {
  const start = performance.now(), blob = await png.start(kind); assert(blob, 'PNG生成失敗');
  const image = await createImageBitmap(blob), result = { width: image.width, height: image.height, bytes: blob.size, milliseconds: round(performance.now() - start) };
  image.close(); return result;
}
const mediaEvent = (media, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => done(new Error('動画再生の待機時間超過')), 15000);
  const success = () => done(), fail = () => done(new Error('動画を再生できない'));
  function done(error) { clearTimeout(timer); media.removeEventListener(name, success); media.removeEventListener('error', fail); error ? reject(error) : resolve(); }
  media.addEventListener(name, success, { once: true }); media.addEventListener('error', fail, { once: true });
});
async function inspectVideo(blob, s) {
  const parsed = demuxWebM(await blob.arrayBuffer()), v = parsed.tracks.find(t => t.type === 1), a = parsed.tracks.find(t => t.type === 2);
  assert(v && a && v.width === s.renderer.canvas.width && v.height === s.renderer.canvas.height, '映像・音声トラックまたは寸法');
  const last = type => Math.max(...parsed.packets.filter(p => p.track === type.number).map(p => p.timestamp / 1e6));
  const audioEnd = last(a), videoEnd = last(v); assert(Math.abs(videoEnd - audioEnd) < .25, '音声・映像の終端が離れている');
  const decoded = await s.audio.context.decodeAudioData(await blob.arrayBuffer());
  assert(Math.abs(decoded.duration - s.audio.buffer.duration) < .4, '動画音声の長さが曲と異なる');
  const rms = [.1, .5, .9].map(part => {
    const data = decoded.getChannelData(0), start = Math.floor(data.length * part), end = Math.min(data.length, start + decoded.sampleRate);
    let sum = 0; for (let i = start; i < end; i++) sum += data[i] ** 2; return round(Math.sqrt(sum / (end - start)));
  }); assert(rms.every(value => value > .0001), '動画の検査区間が無音');
  const player = document.createElement('video'), url = URL.createObjectURL(blob); player.muted = true;
  try {
    const loaded = mediaEvent(player, 'loadeddata'); player.src = url; await loaded;
    const frame = document.createElement('canvas'); frame.width = frame.height = 64; const c = frame.getContext('2d', { willReadFrequently: true }), frameSignals = [];
    for (const part of [.1, .5, .95]) {
      const seeked = mediaEvent(player, 'seeked'); player.currentTime = s.audio.buffer.duration * part; await seeked;
      await player.play(); await wait(80); player.pause();
      c.drawImage(player, 0, 0, 64, 64); const pixels = c.getImageData(0, 0, 64, 64).data;
      let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 25) lit++;
      frameSignals.push(lit); assert(lit > 0, '動画の検査画面に描画がない');
    }
    return { mime: blob.type, bytes: blob.size, audioDuration: round(decoded.duration), audioEnd: round(audioEnd), videoEnd: round(videoEnd), rms, frameSignals };
  } finally { player.pause(); player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
}
async function controls(fn) {
  $('real').disabled = $('fixtures').disabled = $('files').disabled = $('record').disabled = true;
  try { await fn(); }
  catch { report.checks.push({ title: '検証の準備', passed: false, error: '検証を準備できませんでした。音源の選択とブラウザの対応を確認してください。' }); }
  finally { $('real').disabled = $('fixtures').disabled = $('files').disabled = $('record').disabled = false; $('status').textContent = `完了：${report.checks.filter(c => c.passed).length}/${report.checks.length}成功`; saveReport(); }
}
$('real').onclick = () => controls(async () => {
  let files = [...$('files').files];
  if (localSession && location.hostname === '127.0.0.1') {
    const selected = new URLSearchParams(location.search).get('cases')?.split(',').map(Number);
    const manifest = await (await fetch('/local-audio/manifest.json')).json();
    files = manifest.filter(item => !selected || selected.includes(item.caseIndex + 1)).map(item => ({ ...item, name: 'local.mp3',
      arrayBuffer: async () => (await fetch(item.url)).arrayBuffer() }));
  }
  if (!files.length) return;
  const s = session();
  try {
    await s.audio.init();
    for (const [i, file] of files.entries()) await check(`実音源 ${(file.caseIndex ?? i) + 1}`, async entry => {
      const index = file.caseIndex ?? i;
      const alias = `local-${index + 1}`, started = performance.now();
      // Read file bytes locally. No filenames or content-derived IDs enter the report.
      const bytes = await file.arrayBuffer();
      await s.studio.load(options => s.audio.prepare(bytes, options), alias);
      assert(s.studio.name === alias && s.audio.buffer, '音源を読み込めない');
      const loadMs = performance.now() - started, duration = s.audio.buffer.duration;
      const size = [[720, 1280], [1280, 720], [1080, 1080], [720, 1280]][index % 4], style = ['organic', 'geometric', 'particles', 'watercolor'][index % 4];
      await s.studio.configure({ style, theme: 'aurora', strength: 1, trail: 'accumulate' }, size);
      const middle = duration * .5; await s.studio.seek(middle);
      assert(s.renderer.frame === frameCount(middle, duration), 'シークが完了していない');
      await s.studio.togglePlay(); await wait(350); await s.studio.togglePlay(); assert(!s.audio.playing && s.audio.time > middle, '再生・一時停止');
      const position = s.audio.time, current = await pngInfo(s.png, 'current'), complete = await pngInfo(s.png, 'complete');
      assert(s.audio.time === position && !s.audio.playing, 'PNG後の位置が変わった');
      const result = { fileType: file.name.toLowerCase().endsWith('.wav') ? 'WAV' : 'MP3', inputBytes: file.size, duration: round(duration), channels: s.audio.buffer.numberOfChannels,
        sampleRate: s.audio.buffer.sampleRate, pcmBytes: s.audio.buffer.length * s.audio.buffer.numberOfChannels * 4, loadMs: round(loadMs), style, size, current, complete, videoSupport: s.video.support };
      Object.assign(entry, result); saveReport();
      if ($('record').checked && s.video.support.supported) {
        const recordStart = performance.now(), blob = await s.video.start(); assert(blob, s.video.message);
        result.video = await inspectVideo(blob, s); result.video.recordMs = round(performance.now() - recordStart);
        assert(s.audio.time === position && !s.audio.playing, '動画後の位置が変わった');
      }
      s.studio.restart(); assert(s.audio.time === 0 && s.renderer.frame === 0, '先頭戻し');
      s.video.clearResult(); s.png.clearResult(); return result;
    });
  } finally { await s.dispose(); }
});

// Generated fixtures exercise PCM/WAV decoding without committing any audio assets.
function wav(duration, rate, channels, silent = false) {
  const frames = Math.round(duration * rate), bytes = new ArrayBuffer(44 + frames * channels * 2), v = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, i) => v.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, bytes.byteLength - 44, true);
  if (!silent) for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) v.setInt16(44 + (i * channels + c) * 2, Math.sin(2 * Math.PI * (c ? 880 : 110) * i / rate) * 6000, true);
  return bytes;
}
$('fixtures').onclick = () => controls(async () => {
  const s = session();
  try {
    await s.audio.init();
    for (const [title, duration, rate, channels, silent] of [['短いWAV', .113, 8000, 1, false], ['無音WAV', 1, 8000, 2, true], ['10分WAV', 600, 8000, 1, false], ['大容量WAV', 60, 192000, 2, false]]) await check(title, async () => {
      const bytes = wav(duration, rate, channels, silent), started = performance.now();
      await s.studio.load(options => s.audio.prepare(bytes, options), 'fixture'); assert(s.studio.message.startsWith('解析完了'), 'WAV読込');
      const loadMs = performance.now() - started; await s.studio.seek(duration);
      assert(s.renderer.frame === frameCount(duration, s.audio.buffer.duration), '曲末復元');
      const complete = await pngInfo(s.png, 'complete');
      if (silent) assert(s.audio.features.every(f => f.volume === 0 && !f.beat), '無音解析');
      return { duration, inputBytes: bytes.byteLength, loadMs: round(loadMs), outputSampleRate: s.audio.buffer.sampleRate, complete };
    });
    await check('破損音源 → 以前の曲に復帰', async () => {
      const previous = s.audio.buffer; await s.studio.load(options => s.audio.prepare(new Uint8Array([1, 2, 3, 4]).buffer, options), 'bad');
      assert(s.audio.buffer === previous && s.studio.state === 'ready' && !s.studio.loading, '以前の曲に戻れない');
      await s.studio.togglePlay(); assert(s.audio.playing, '失敗後に再生不可'); await s.studio.togglePlay(); return { recovered: true };
    });
  } finally { await s.dispose(); }
});
