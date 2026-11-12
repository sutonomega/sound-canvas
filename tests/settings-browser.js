import { AudioEngine } from '../dist/audio.js';
import { StudioController } from '../dist/controller.js';
import { Renderer, RENDER_VERSION } from '../dist/renderer.js';
import { SettingsPanel, aspectRatios } from '../dist/settings-ui.js';
import { styleRegistry } from '../dist/styles/index.js';
import { themes } from '../dist/themes.js';
import { organicStress } from './organic-fixtures.js';
const $ = id => document.getElementById(id);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pixels = r => r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
const equal = (a, b) => { assert(a.length === b.length, '画素数'); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`画素差 ${i}`); };
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
let urls = [];
$('run').onclick = async () => {
  $('run').disabled = true; $('results').replaceChildren(); $('preview').replaceChildren();
  $('save-image').hidden = $('save-report').hidden = true; urls.forEach(URL.revokeObjectURL); urls = [];
  const report = { environment: navigator.userAgent, rendererVersion: RENDER_VERSION, seed: 12345,
    duration: 6, matrixSeconds: .4, comparisons: [], checks: [] };
  let total = 0, passed = 0, renderer, reference;
  const check = async (title, fn) => {
    total++; const item = document.createElement('li');
    try { await fn(); passed++; item.className = 'pass'; item.textContent = `PASS ${title}`; report.checks.push({ title, passed: true }); }
    catch (error) { item.className = 'fail'; item.textContent = `FAIL ${title}：${error.message}`; report.checks.push({ title, passed: false, error: error.message }); }
    $('results').append(item); $('summary').textContent = `確認中：${passed}/${total} 成功`;
    await new Promise(requestAnimationFrame);
  };
  try {
    const source = await (await fetch('../dist/index.html')).text();
    const iframe = document.createElement('iframe'); iframe.title = '実際の設定パネル';
    const loaded = new Promise(resolve => iframe.onload = resolve);
    iframe.srcdoc = source.replace('<head>', '<head><base href="/dist/">')
      .replace('<link rel="stylesheet" href="style.css">', '<base href="/dist/"><link rel="stylesheet" href="style.css">')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    $('preview').append(iframe); await loaded;
    const d = iframe.contentDocument, control = id => d.getElementById(id);
    renderer = new Renderer(control('canvas')); reference = new Renderer(document.createElement('canvas'));
    let yieldTask = async () => {}, pending = [], panel;
    const audio = new AudioEngine(); audio.context = { currentTime: 0, resume: async () => {}, destination: {},
      createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }) };
    const studio = new StudioController(audio, renderer, () => {
      panel.update(renderer, { locked: !studio.canConfigure, restoring: studio.restoring });
      control('png').disabled = !studio.canSave;
    }, () => yieldTask());
    panel = new SettingsPanel(d, (patch, size) => { const work = studio.configure(patch, size); pending.push(work); return work; });
    const sync = () => { panel.update(renderer, { locked: !studio.canConfigure, restoring: studio.restoring }); control('png').disabled = !studio.canSave; };
    const change = (id, value, event = 'change') => { control(id).value = value; control(id).dispatchEvent(new iframe.contentWindow.Event(event, { bubbles: true })); };
    const click = (attribute, value) => d.querySelector(`[data-${attribute}="${value}"]`).click();
    const settle = async () => { await Promise.all(pending); pending = []; };
    const track = { seed: report.seed, buffer: { duration: 6 }, features: Array.from({ length: 180 }, (_, i) => organicStress(i)),
      analysis: { version: 'settings-fixture-1', trackKey: 'settings-fixture' } };
    const selected = (attribute, value) => {
      const buttons = [...d.querySelectorAll(`[data-${attribute}]`)];
      assert(buttons.filter(b => b.getAttribute('aria-pressed') === 'true').length === 1, `${attribute}の単独選択`);
      assert(buttons.find(b => b.dataset[attribute] === value).getAttribute('aria-pressed') === 'true', `${attribute}の選択一致`);
    };
    const compare = () => {
      reference.configure(renderer.settings, [renderer.canvas.width, renderer.canvas.height]);
      reference.reset(audio.seed, renderer.metadata);
      for (let i = 0; i < studio.target; i++) reference.step(audio.feature(i), { present: false }); reference.present();
      equal(pixels(renderer), pixels(reference));
      assert(JSON.stringify(renderer.style.snapshot()) === JSON.stringify(reference.style.snapshot()), '内部状態');
    };
    sync();
    await check('初期設定は曲線・Aurora・100%・蓄積・9:16、未読込は設定可能でPNG不可', () => {
      assert(renderer.settings.style === 'organic' && control('theme').value === 'aurora' && control('strength').value === '100' && control('trail').value === 'accumulate', '初期設定');
      selected('ratio', 'portrait'); selected('style', 'organic'); assert(!control('theme').disabled && control('png').disabled, '操作可否');
    });
    await check('読込前の選択を保持し、解析中は全設定を無効化する', async () => {
      click('style', 'watercolor'); change('theme', 'ember'); change('strength', '25'); change('trail', 'fade'); click('ratio', 'square'); await settle();
      const candidate = gate(), loading = studio.load(() => candidate.promise, 'fixture');
      assert([...d.querySelectorAll('[data-style],[data-ratio],#theme,#strength,#trail')].every(el => el.disabled), '一部設定が有効');
      assert(control('settings-panel').getAttribute('aria-busy') === 'true', '処理中の表示');
      candidate.resolve(track); await loading;
      selected('style', 'watercolor'); selected('ratio', 'square'); assert(control('theme').value === 'ember' && control('strength').value === '25' && control('trail').value === 'fade', '読込で設定が変わる');
    });
    await check('入力中の反応値は画面更新で戻らず、確定時にだけ再計算する', async () => {
      const generation = studio.generation; change('strength', '163', 'input'); sync();
      assert(control('strength').value === '163' && control('strength-value').value === '163%', '入力値が戻った');
      assert(renderer.settings.strength === .25 && studio.generation === generation, '未確定の再計算');
      change('strength', '163'); await settle(); assert(renderer.settings.strength === 1.63, '確定値');
      change('strength', '50', 'input'); control('strength').dispatchEvent(new iframe.contentWindow.Event('pointercancel')); sync();
      assert(control('strength').value === '163' && control('strength-value').value === '163%', '取消表示');
    });
    for (const style of Object.keys(styleRegistry)) for (const theme of Object.keys(themes))
      for (const trail of ['accumulate', 'fade']) for (const [ratioId, ratio] of Object.entries(aspectRatios))
        for (const strength of [.25, 1, 2]) {
          await check(`${style} / ${theme} / ${trail} / ${ratio.label} / ${strength * 100}%`, async () => {
            click('style', style); change('theme', theme); change('trail', trail); click('ratio', ratioId); change('strength', String(strength * 100));
            await settle(); await studio.seek(.4); sync(); selected('style', style); selected('ratio', ratioId);
            assert(renderer.settings.theme === theme && renderer.settings.trail === trail && renderer.settings.strength === strength, '設定適用');
            assert(control('theme').value === theme && control('trail').value === trail && control('strength-value').value === `${strength * 100}%`, '入力の表示');
            assert(control('dimensions').textContent === `${ratio.width} × ${ratio.height}`, '解像度の表示');
            const swatches = [...control('swatches').children];
            assert(swatches.length === themes[theme].colors.length, '色見本の数');
            themes[theme].colors.forEach((hue, i) => { const probe = d.createElement('i'); probe.style.backgroundColor = `hsl(${hue},85%,60%)`;
              assert(swatches[i].style.backgroundColor === probe.style.backgroundColor, '色見本の色'); });
            assert(studio.canSave && !control('png').disabled, '完了後のPNG'); compare();
          });
        }
    await check('同じ選択は再計算も再生中断もしない', async () => {
      await studio.togglePlay(); const generation = studio.generation, snapshot = JSON.stringify(renderer.style.snapshot());
      click('style', renderer.settings.style); click('ratio', 'square'); await settle();
      assert(studio.generation === generation && audio.playing, '不要な再計算'); assert(JSON.stringify(renderer.style.snapshot()) === snapshot, '描画変化');
    });
    await check('復元中の連続設定変更とシークは最後の内容だけを保存する', async () => {
      const hold = gate(); yieldTask = () => hold.promise;
      pending.push(studio.seek(5)); change('theme', 'aurora'); click('style', 'organic'); change('trail', 'fade');
      click('ratio', 'landscape'); change('strength', '25'); pending.push(studio.seek(2));
      assert(!control('theme').disabled && control('png').disabled, '復元中の操作可否');
      assert(control('settings-panel').getAttribute('aria-busy') === 'true', '復元中の表示');
      hold.resolve(); await settle(); yieldTask = async () => {}; sync();
      selected('style', 'organic'); selected('ratio', 'landscape');
      assert(audio.playing && audio.time === 2 && renderer.frame === 60, '最終位置・再生意図'); compare();
    });
    await check('不正な設定は画面と描画を前の選択へ戻す', async () => {
      const before = pixels(renderer); await studio.configure({ theme: 'invalid' }); sync();
      assert(control('theme').value === renderer.settings.theme && audio.playing && studio.canSave, '失敗後の状態'); equal(pixels(renderer), before);
    });
    await check('読込失敗後も設定と保存可能な描画を維持する', async () => {
      await studio.load(async () => { throw new Error('test failure'); }, 'broken'); sync();
      assert(!audio.playing && studio.canSave && !control('theme').disabled, '失敗からの復帰'); selected('ratio', 'landscape'); compare();
    });
    await check('読込中止で設定が再び操作でき、古い読込結果を反映しない', async () => {
      const candidate = gate(), work = studio.load(() => candidate.promise, 'cancelled');
      await studio.cancelLoad(); candidate.resolve({ ...track, seed: 999 }); await work; sync();
      assert(audio.seed === report.seed && !control('theme').disabled && studio.canSave, '中止後の状態'); compare();
    });
    const sheet = document.createElement('canvas'); sheet.width = 2240; sheet.height = 1040;
    const c = sheet.getContext('2d'); c.fillStyle = '#10131b'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.fillStyle = '#eaf3ff'; c.font = '30px sans-serif'; c.fillText('Sound Canvas / 4 styles + shared settings', 32, 45);
    const examples = [['organic', 'aurora', 'portrait'], ['geometric', 'ember', 'square'], ['particles', 'ocean', 'landscape'], ['watercolor', 'ember', 'portrait']];
    for (const [i, [style, theme, ratioId]] of examples.entries()) {
      click('style', style); change('theme', theme); change('trail', 'accumulate'); change('strength', '100'); click('ratio', ratioId); await settle(); await studio.seek(6); sync();
      const x = 32 + i * 552, ratio = aspectRatios[ratioId];
      c.fillStyle = '#d5f5a0'; c.font = '24px sans-serif'; c.fillText(styleRegistry[style].label, x, 90);
      c.fillStyle = '#a5b2c3'; c.font = '18px sans-serif'; c.fillText(`${theme} / ${ratio.label} / 100% / 蓄積 / 0:06`, x, 123);
      themes[theme].colors.forEach((hue, j) => { c.fillStyle = `hsl(${hue},85%,60%)`; c.fillRect(x + j * 100, 140, 96, 8); });
      const factor = Math.min(500 / ratio.width, 820 / ratio.height);
      c.drawImage(renderer.canvas, x + (500 - ratio.width * factor) / 2, 172 + (820 - ratio.height * factor) / 2, ratio.width * factor, ratio.height * factor);
      report.comparisons.push({ style, theme, ratio: ratio.label, strength: 1, trail: 'accumulate', seconds: 6 });
    }
    report.total = total; report.passed = passed;
    if (passed === total) {
      const image = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
      for (const [id, blob] of [['save-image', image], ['save-report', new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })]]) {
        const url = URL.createObjectURL(blob); urls.push(url); $(id).href = url; $(id).hidden = false;
      }
    }
    $('report').textContent = JSON.stringify(report, null, 2); $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  } catch (error) { $('summary').textContent = `確認を完了できませんでした：${error.message}`; }
  finally { const frame = $('preview').querySelector('iframe'); if (frame) { frame.inert = true; frame.title = '設定の検証結果（操作不可）'; } renderer?.dispose(); reference?.dispose(); $('run').disabled = false; }
};
