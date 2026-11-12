import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { StudioController } from './controller.js';
import { SettingsPanel } from './settings-ui.js';

const $ = id => document.getElementById(id);
const audio = new AudioEngine(), renderer = new Renderer($('canvas'));
const studio = new StudioController(audio, renderer, updateUI);
const settingsPanel = new SettingsPanel(document, (patch, size) => studio.configure(patch, size));
const format = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
let scrubbing = false;

function updateUI() {
  const hasTrack = !!audio.buffer;
  $('play').disabled = !hasTrack || studio.loading || studio.restoring || studio.starting;
  $('restart').disabled = !hasTrack || studio.loading;
  $('seek').disabled = !hasTrack || studio.loading;
  $('png').disabled = !studio.canSave;
  settingsPanel.update(renderer, { locked: !studio.canConfigure, restoring: studio.restoring });
  $('cancel-load').hidden = !studio.loading;
  $('drop').setAttribute('aria-busy', String(studio.loading));
  text('filename', studio.name || '楽曲をドロップ / 選択');
  text('message', studio.message); text('status', studio.status);
  $('empty').hidden = hasTrack;
  text('duration', format(audio.buffer?.duration ?? 0));
  text('time', format(audio.time));
  $('seek').max = audio.buffer?.duration ?? 1;
  if (!scrubbing) $('seek').value = audio.time;
  text('play', audio.playing ? 'Ⅱ' : '▶');
  $('play').setAttribute('aria-label', audio.playing ? '一時停止' : '再生');
}

function loadFile(file) {
  if (!file) return;
  return studio.load(async options => {
    if (!/\.(mp3|wav)$/i.test(file.name)) throw new Error('MP3またはWAVファイルを選んでください。');
    const bytes = await file.arrayBuffer();
    options.signal.throwIfAborted();
    return audio.prepare(bytes, options);
  }, file.name);
}

$('file').onchange = event => { loadFile(event.target.files[0]); event.target.value = ''; };
$('demo').onclick = () => studio.load(options => audio.prepareDemo(options), 'First Light — デモ音源');
$('cancel-load').onclick = () => studio.cancelLoad();
const drop = $('drop');
drop.ondragover = event => { event.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = event => { event.preventDefault(); drop.classList.remove('over'); loadFile(event.dataTransfer.files[0]); };
$('play').onclick = () => studio.togglePlay();
$('restart').onclick = () => studio.restart();
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
