import { AudioEngine } from '../dist/audio.js';
import { StudioController } from '../dist/controller.js';
import { Renderer } from '../dist/renderer.js';
import { VideoExporter } from '../dist/video.js';
import { frameCount } from '../dist/timing.js';
const $ = id => document.getElementById(id);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (target, type, timeout = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(new Error(`${type}の待機時間を超過`)); }, timeout);
  const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error(`${type}でメディアエラー`)); };
  const cleanup = () => { clearTimeout(timer); target.removeEventListener(type, done); target.removeEventListener('error', fail); };
  target.addEventListener(type, done, { once: true }); target.addEventListener('error', fail, { once: true });
});
const pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
const equal = (a, b) => { assert(a.length === b.length, '画素数'); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`画素差 ${i}`); };
function tracks(bytes) {
  const data = new Uint8Array(bytes), result = [];
  const vint = (offset, keep) => {
    let length = 1, bit = 128; while (length <= 8 && !(data[offset] & bit)) { length++; bit >>= 1; }
    if (length > 8 || offset + length > data.length) throw new Error('WebMの整数形式');
    let value = keep ? data[offset] : data[offset] & (bit - 1);
    for (let i = 1; i < length; i++) value = value * 256 + data[offset + i];
    return { value, length };
  };
  const scan = (start, end, track = null) => {
    let offset = start;
    while (offset < end) {
      const id = vint(offset, true); offset += id.length; const size = vint(offset, false); offset += size.length;
      const stop = Math.min(end, offset + size.value); if (stop < offset) break;
      if (id.value === 0xae) { const entry = {}; result.push(entry); scan(offset, stop, entry); }
      else if ([0x18538067, 0x1654ae6b, 0xe0, 0xe1].includes(id.value)) scan(offset, stop, track);
      else if (track && id.value === 0x83) track.type = data[offset];
      else if (track && id.value === 0x86) track.codec = new TextDecoder().decode(data.slice(offset, stop));
      else if (track && [0xb0, 0xba].includes(id.value)) {
        let value = 0; for (let i = offset; i < stop; i++) value = value * 256 + data[i]; track[id.value === 0xb0 ? 'width' : 'height'] = value;
      }
      if (stop <= offset && size.value !== 0) break;
      offset = stop;
    }
  };
  scan(0, data.length); return result;
}
$('visibility').textContent = `画面の状態：${document.visibilityState}`;
let sampleURL = null, reportURL = null;
$('run').onclick = async () => {
  $('run').disabled = true; $('results').replaceChildren(); $('preview').replaceChildren();
  $('save-video').hidden = $('save-report').hidden = true;
  if (sampleURL) URL.revokeObjectURL(sampleURL); if (reportURL) URL.revokeObjectURL(reportURL);
  let total = 0, passed = 0; const report = { environment: navigator.userAgent, visibility: document.visibilityState, recordings: [], checks: [] };
  const check = async (title, fn) => {
    total++; const li = document.createElement('li');
    try { await fn(); passed++; li.className = 'pass'; li.textContent = `PASS ${title}`; report.checks.push({ title, passed: true }); }
    catch (error) { li.className = 'fail'; li.textContent = `FAIL ${title}：${error.message}`; report.checks.push({ title, passed: false, error: error.message }); }
    $('results').append(li); $('summary').textContent = `確認中：${passed}/${total} 成功`;
  };
  const audio = new AudioEngine(), canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
  $('preview').append(canvas); const renderer = new Renderer(canvas), studio = new StudioController(audio, renderer);
  const exporter = new VideoExporter(studio, () => $('progress').textContent = `${exporter.state} / ${exporter.percent}% / ${exporter.message}`);
  let sample;
  try {
    const context = audio.ensureContext(); await audio.init();
    const make = async (silent = false) => {
      const rate = 16000, buffer = context.createBuffer(2, Math.round(rate * 3.113), rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        if (!silent) for (let i = 0; i < data.length; i++) {
          const t = i / rate; data[i] = .25 * Math.sin(2 * Math.PI * (channel ? 330 : 220) * t)
            + .22 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-(t % .4) * 16)
            + .06 * Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-(t % .2) * 15);
        }
      }
      return audio.analyze(buffer);
    };
    const audible = await make(), silence = await make(true);
    report.support = exporter.support;
    const cases = [
      ['watercolor', [720, 1280], false], ['geometric', [1280, 720], false], ['particles', [1080, 1080], false],
      ['organic', [720, 1280], false], ['organic', [720, 1280], true],
    ];
    for (const [style, size, silent] of cases) await check(`${style} / ${size.join('×')} / ${silent ? '無音' : '音声あり'}：WebMと復帰`, async () => {
      renderer.configure({ style, theme: 'aurora', strength: 1, trail: 'accumulate' }, size);
      await studio.load(async () => silent ? silence : audible, 'synthetic.wav'); await studio.seek(1.1);
      const before = pixels(canvas), beforeState = JSON.stringify(renderer.style.snapshot());
      const done = exporter.start(), job = exporter.job;
      assert(studio.exporting && !studio.canSave && !studio.canConfigure, '録画の排他');
      const blob = await done; assert(blob?.size > 0 && exporter.state === 'ready', exporter.message || 'WebMが無い');
      assert(audio.time === 1.1 && !audio.playing && studio.canSave, '元位置の停止状態'); equal(pixels(canvas), before);
      assert(JSON.stringify(renderer.style.snapshot()) === beforeState, '元位置の内部状態');
      assert(job.stream.getTracks().every(t => t.readyState === 'ended'), 'トラックが残る');
      assert(!job.recorder.ondataavailable && !job.recorder.onstop && job.rafs.size === 0 && job.timers.size === 0, '後片付け');
      assert(exporter.info.finalFrame === frameCount(audio.buffer.duration, audio.buffer.duration), '曲末のフレーム');
      const bytes = await blob.arrayBuffer(), entries = tracks(bytes);
      assert(entries.some(t => t.type === 1 && t.width === size[0] && t.height === size[1]), '映像トラックのサイズ');
      assert(entries.some(t => t.type === 2 && t.codec === 'A_OPUS'), 'Opus音声トラック');
      const decoded = await context.decodeAudioData(bytes.slice(0));
      let square = 0, count = 0;
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) for (const value of decoded.getChannelData(ch)) { square += value * value; count++; }
      const rms = Math.sqrt(square / count); assert(silent ? rms < .001 : rms > .01, `録音音量 ${rms}`);
      assert(decoded.duration >= audio.buffer.duration - .1 && decoded.duration < audio.buffer.duration + 1, '録音の長さ');
      const playback = document.createElement('video'); playback.muted = true; playback.controls = true;
      $('preview').append(playback); const loaded = event(playback, 'loadedmetadata'); playback.src = exporter.url; await loaded;
      assert(playback.videoWidth === size[0] && playback.videoHeight === size[1], '再生時のサイズ');
      const ended = event(playback, 'ended', 10000); await playback.play(); await ended;
      const frame = document.createElement('canvas'); [frame.width, frame.height] = size;
      frame.getContext('2d', { willReadFrequently: true }).drawImage(playback, 0, 0); const data = pixels(frame);
      let lit = 0; for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 45) lit++;
      assert(silent || lit > 20, `再生画像に描画が無い ${lit}`);
      report.recordings.push({ style, width: size[0], height: size[1], silent, mimeType: blob.type, bytes: blob.size, tracks: entries,
        inputSeconds: audio.buffer.duration, decodedAudioSeconds: decoded.duration, rms, litPixelsAtEnd: lit,
        finalFrame: exporter.info.finalFrame, restoredTime: audio.time, restoredPixelDifference: 0 });
      playback.pause(); playback.removeAttribute('src'); playback.load(); playback.remove();
      if (!sample && !silent) sample = blob;
    });
    await check('録画中止は途中データを捨て、再度録画できる', async () => {
      renderer.configure({ style: 'organic' }, [720, 1280]); await studio.load(async () => audible, 'synthetic.wav'); await studio.seek(.7);
      const done = exporter.start(); await wait(300); exporter.cancel(); await done;
      assert(!exporter.blob && !exporter.url && !studio.exporting && studio.canSave && audio.time === .7, '中止後の復帰');
      const second = await exporter.start(); assert(second?.size && exporter.state === 'ready', '再録画');
    });
    report.total = total; report.passed = passed;
    if (passed === total && sample) {
      sampleURL = URL.createObjectURL(sample); $('save-video').href = sampleURL; $('save-video').hidden = false;
      reportURL = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      $('save-report').href = reportURL; $('save-report').hidden = false;
      const player = document.createElement('video'); player.src = sampleURL; player.controls = true; $('preview').append(player);
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { exporter.dispose(); studio.cache.clear(); renderer.dispose(); await audio.context?.close(); $('run').disabled = false; }
};
