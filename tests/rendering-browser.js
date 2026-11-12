import { Renderer } from '../dist/renderer.js';
import { styleRegistry } from '../dist/styles/index.js';

const $ = id => document.getElementById(id);
const sample = frame => ({ volume: .5 + Math.sin(frame * .13) * .3, bass: .4, mid: .5, high: .2,
  beat: frame % 15 === 0, intensity: .6 });
const create = (size = [36, 64], styles) => {
  const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = size;
  return new Renderer(canvas, styles ? { styles } : {});
};
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
const assert = (condition, text) => { if (!condition) throw new Error(text); };
function equal(a, b) {
  assert(a.length === b.length, '画素数が異なります');
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `画素差 index=${i}: ${a[i]} / ${b[i]}`);
}
function runFrames(renderer, start, end, present = false) {
  for (let frame = start; frame < end; frame++) renderer.step(sample(frame), { present });
  renderer.present();
}
const probe = {
  id: 'probe', version: 'probe-1', create() {
    let frame = 0, width, height;
    return {
      reset(options) { frame = 0; ({ width, height } = options); },
      step({ layers }) {
        if (frame === 0) {
          layers.drawing.fillStyle = '#ff0000'; layers.drawing.fillRect(0, 0, width / 2, height);
          layers.effects.fillStyle = '#00ff00'; layers.effects.fillRect(width / 4, 0, width / 4, height);
        }
        frame++;
      },
      snapshot() { return { frame }; }, restore(state) { frame = state.frame; }, dispose() {},
    };
  },
};
const probeRenderer = () => {
  const renderer = create([32, 32], { ...styleRegistry, probe });
  renderer.configure({ style: 'probe' }); return renderer;
};
const pixel = (renderer, x, y) => Array.from(renderer.ctx.getImageData(x, y, 1, 1).data);

$('run').onclick = async () => {
  $('run').disabled = true; $('results').replaceChildren(); $('sample').replaceChildren();
  $('environment').textContent = navigator.userAgent;
  let total = 0, passed = 0;
  const check = async (name, operation) => {
    total++; const item = document.createElement('li');
    try { await operation(); passed++; item.className = 'pass'; item.textContent = `PASS ${name}`; }
    catch (error) { item.className = 'fail'; item.textContent = `FAIL ${name}: ${error.message}`; }
    $('results').append(item); $('summary').textContent = `確認中：${passed}/${total} 成功`;
    await new Promise(resolve => requestAnimationFrame(resolve));
  };

  await check('背景→蓄積→演出の合成順', () => {
    const r = probeRenderer(); r.step(sample(0));
    equal(pixel(r, 4, 4), [255, 0, 0, 255]); equal(pixel(r, 12, 4), [0, 255, 0, 255]);
    assert(pixel(r, 24, 4)[3] === 255, '背景が透明'); r.dispose();
  });
  await check('演出は消え、蓄積は残る', () => {
    const r = probeRenderer(); r.step(sample(0)); r.step(sample(1));
    equal(pixel(r, 12, 4), [255, 0, 0, 255]); r.dispose();
  });
  await check('減衰は描画層を透明へ戻す', () => {
    const r = probeRenderer(); r.configure({ trail: 'fade' }); r.step(sample(0));
    const before = r.layers.drawing.ctx.getImageData(4, 4, 1, 1).data[3];
    for (let i = 0; i < 60; i++) r.step(sample(i), { present: false });
    const after = r.layers.drawing.ctx.getImageData(4, 4, 1, 1).data[3];
    assert(before === 255 && after > 0 && after < 110, `${before}→${after}`); r.dispose();
  });

  for (const style of Object.keys(styleRegistry)) {
  for (const [ratio, size] of [['9:16', [36, 64]], ['16:9', [64, 36]], ['1:1', [48, 48]]]) {
    for (const theme of ['aurora', 'ember', 'ocean']) {
      for (const trail of ['accumulate', 'fade']) {
        await check(`${style} / ${ratio} / ${theme} / ${trail}：復元と再計算の画素一致`, () => {
          const r = create(size); r.configure({ style, theme, trail });
          const metadata = { duration: 4, trackKey: 'test', analysisVersion: 'test' };
          r.reset(12345, metadata); runFrames(r, 0, 40);
          const saved = r.snapshot(); runFrames(r, 40, 90);
          const expected = pixels(r.canvas), expectedState = JSON.stringify(r.snapshot().styleState);
          r.restore(saved); runFrames(r, 40, 90);
          equal(pixels(r.canvas), expected);
          assert(JSON.stringify(r.snapshot().styleState) === expectedState, '内部状態・乱数が不一致');
          r.reset(12345, metadata); runFrames(r, 0, 90); equal(pixels(r.canvas), expected);
          r.dispose();
        });
      }
    }
  }
  }
  for (const style of Object.keys(styleRegistry)) {
  await check(`${style}：曲末の合成画面と内部状態を保持`, () => {
    const r = create(); r.configure({ style }); r.reset(9, { duration: .11 }); runFrames(r, 0, 4);
    const expected = pixels(r.canvas), state = JSON.stringify(r.snapshot().styleState);
    for (let i = 0; i < 30; i++) assert(r.step(sample(i)) === false, '終端後に更新');
    equal(pixels(r.canvas), expected); assert(state === JSON.stringify(r.snapshot().styleState), '終端後に状態変化');
    r.dispose();
  });
  await check(`${style}：毎ステップ合成と一括合成が一致`, () => {
    const a = create(), b = create(); a.configure({ style }); b.configure({ style }); a.reset(98); b.reset(98);
    runFrames(a, 0, 90, true); runFrames(b, 0, 90, false);
    equal(pixels(a.canvas), pixels(b.canvas)); a.dispose(); b.dispose();
  });
  for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) {
    await check(`${style} / ${size.join('×')}：合成キャンバスのPNGと画素・サイズが一致`, async () => {
      const r = create(size); r.configure({ style }); r.reset(345); runFrames(r, 0, 30);
      const blob = await new Promise(resolve => r.canvas.toBlob(resolve, 'image/png'));
      assert(blob?.type === 'image/png', 'PNG生成失敗');
      const bitmap = await createImageBitmap(blob);
      assert(bitmap.width === size[0] && bitmap.height === size[1], 'PNGのサイズが不一致');
      const copy = document.createElement('canvas'); [copy.width, copy.height] = size;
      copy.getContext('2d').drawImage(bitmap, 0, 0); equal(pixels(copy), pixels(r.canvas)); bitmap.close();
      if (size[0] === 720) { const preview = document.createElement('canvas'); [preview.width, preview.height] = size;
        preview.getContext('2d').drawImage(r.canvas, 0, 0); $('sample').append(preview); }
      r.dispose();
    });
  }
  }
  $('summary').textContent = `完了：${passed}/${total} 成功、失敗 ${total - passed}`;
  $('run').disabled = false;
};
