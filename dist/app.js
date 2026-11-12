import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { StudioController } from './controller.js';
import { SettingsPanel } from './settings-ui.js';
import { VideoExporter } from './video.js';

const $ = id => document.getElementById(id);
const audio = new AudioEngine(), renderer = new Renderer($('canvas'));
const studio = new StudioController(audio, renderer, updateUI);
const settingsPanel = new SettingsPanel(document, (patch, size) => studio.configure(patch, size));
const video = new VideoExporter(studio, updateUI);
const format = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
let scrubbing = false;

function updateUI() {
  const hasTrack = !!audio.buffer;
  $('play').disabled = !hasTrack || studio.exporting || studio.loading || studio.restoring || studio.starting;
  $('restart').disabled = !hasTrack || studio.exporting || studio.loading;
  $('seek').disabled = !hasTrack || studio.exporting || studio.loading;
  $('file').disabled = studio.exporting;
  $('demo').disabled = studio.exporting;
  $('drop').classList.toggle('locked', studio.exporting);
  $('cancel-restore').hidden = studio.exporting;
  $('video-start').disabled = !video.canStart;
  $('video-cancel').hidden = !video.busy;
  $('video-cancel').disabled = ['finishing', 'restoring'].includes(video.state);
  $('video-progress').hidden = !video.busy;
  $('video-meter').value = video.percent;
  text('video-progress-label', `${format(video.elapsed)} / ${format(audio.buffer?.duration ?? 0)} · ${video.percent}%`);
  text('video-message', video.support.supported ? video.message || '曲の長さと同じ時間がかかります。この画面を表示したまま録画します。' : video.support.reason);
  $('video-save').hidden = !video.url;
  if (video.url) { $('video-save').href = video.url; text('video-result', `録画した曲：${video.info.name}`); }
  else text('video-result', '');
  $('png').disabled = !studio.canSave;
  settingsPanel.update(renderer, { locked: !studio.canConfigure, restoring: studio.restoring,
    lockMessage: studio.exporting ? '録画が終わるまで設定を変更できません。' : '解析中は設定を変更できません。' });
  $('cancel-load').hidden = !studio.loading;
  $('restore-progress').hidden = !studio.restoring;
  if (studio.progress) {
    $('restore-meter').value = studio.progress.percent;
    text('restore-detail', `${format(studio.progress.targetTime)}へ移動中 · ${studio.progress.percent}%`);
  }
  $('drop').setAttribute('aria-busy', String(studio.loading));
  text('filename', studio.name || '楽曲をドロップ / 選択');
  text('message', studio.message); text('status', video.busy ? video.message : studio.status);
  $('empty').hidden = hasTrack;
  text('duration', format(audio.buffer?.duration ?? 0));
  text('time', format(video.busy && video.state !== 'restoring' ? video.elapsed : audio.time));
  $('seek').max = audio.buffer?.duration ?? 1;
  if (!scrubbing) $('seek').value = video.busy && video.state !== 'restoring' ? video.elapsed : audio.time;
  text('play', audio.playing ? 'Ⅱ' : '▶');
  $('play').setAttribute('aria-label', audio.playing ? '一時停止' : '再生');
}

function loadFile(file) {
  if (!file || studio.exporting) return;
  video.clearResult();
  return studio.load(async options => {
    if (!/\.(mp3|wav)$/i.test(file.name)) throw new Error('MP3またはWAVファイルを選んでください。');
    const bytes = await file.arrayBuffer();
    options.signal.throwIfAborted();
    return audio.prepare(bytes, options);
  }, file.name);
}

$('file').onchange = event => { loadFile(event.target.files[0]); event.target.value = ''; };
$('demo').onclick = () => { if (studio.exporting) return; video.clearResult(); studio.load(options => audio.prepareDemo(options), 'First Light — デモ音源'); };
$('cancel-load').onclick = () => studio.cancelLoad();
const drop = $('drop');
drop.ondragover = event => { event.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = event => { event.preventDefault(); drop.classList.remove('over'); loadFile(event.dataTransfer.files[0]); };
$('play').onclick = () => studio.togglePlay();
$('restart').onclick = () => studio.restart();
$('cancel-restore').onclick = () => studio.cancelRestore();
$('video-start').onclick = () => video.start();
$('video-cancel').onclick = () => video.cancel();
window.addEventListener('pagehide', () => video.dispose());
$('seek').onpointerdown = () => { scrubbing = true; };
window.addEventListener('pointerup', () => { scrubbing = false; });
$('seek').onpointercancel = $('seek').onblur = () => { scrubbing = false; };
$('seek').onchange = () => { scrubbing = false; studio.seek(Number($('seek').value)); };
$('png').onclick = () => {
  if (!studio.canSave) return;
  $('canvas').toBlob(blob => {
    if (!blob) { studio.status = 'PNGを作成できませんでした。もう一度お試しください。'; updateUI(); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'sound-canvas.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
};

// Illustrative initial canvas; replaced by the actual song after loading.
for (let i = 0; i < 180; i++) renderer.step({ volume: .6, bass: .4, mid: .5, high: .3, beat: false }, { present: false });
renderer.present();
function tick() { studio.tick(); updateUI(); requestAnimationFrame(tick); }
tick();
