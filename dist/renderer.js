import { STEP_RATE, frameCount, stepDuration } from './timing.js';
import { themes } from './themes.js';
import { styleRegistry } from './styles/index.js';
export { palettes } from './themes.js';

export const RENDER_VERSION = 'sc-renderer-3';
const layerNames = ['background', 'drawing', 'effects'];
const validSize = (width, height) => Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0;

export class Renderer {
  constructor(canvas, { styles = styleRegistry, createCanvas = () => document.createElement('canvas') } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!this.ctx) throw new Error('Canvas 2Dを利用できません。');
    this.styles = Object.freeze({ ...styles });
    this.createCanvas = createCanvas;
    this.layers = Object.fromEntries(layerNames.map(name => {
      const surface = createCanvas(), ctx = surface.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('描画レイヤーを作成できません。');
      return [name, { canvas: surface, ctx }];
    }));
    this.settings = Object.freeze({ style: 'organic', theme: 'aurora', strength: 1, trail: 'accumulate' });
    this.metadata = { trackKey: null, analysisVersion: null, duration: null };
    this.disposed = false;
    this.reset(1);
  }

  assertActive() {
    if (this.disposed) throw new Error('描画エンジンは終了しています。');
  }

  createStyle(settings, seed, width, height) {
    const definition = Object.hasOwn(this.styles, settings.style) ? this.styles[settings.style] : null;
    if (!definition || definition.id !== settings.style || typeof definition.version !== 'string'
        || typeof definition.create !== 'function') throw new Error('描画スタイルが見つかりません。');
    const instance = definition.create();
    try {
      if (!['reset', 'step', 'snapshot', 'restore', 'dispose'].every(method => typeof instance?.[method] === 'function')) {
        throw new Error('描画スタイルの形式が不正です。');
      }
      instance.reset({ width, height, seed, settings });
      return instance;
    } catch (error) { instance?.dispose?.(); throw error; }
  }

  initialize(seed, metadata, settings, width, height) {
    this.assertActive();
    if (!validSize(width, height) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error('描画サイズまたはシードが不正です。');
    }
    if (!Object.hasOwn(themes, settings.theme) || !['accumulate', 'fade'].includes(settings.trail)
        || !Number.isFinite(settings.strength) || settings.strength < .25 || settings.strength > 2) {
      throw new Error('描画設定が不正です。');
    }
    const nextMetadata = {
      trackKey: metadata.trackKey ?? null,
      analysisVersion: metadata.analysisVersion ?? null,
      duration: metadata.duration ?? null,
    };
    if ((nextMetadata.duration !== null && (!Number.isFinite(nextMetadata.duration) || nextMetadata.duration < 0))
        || ![nextMetadata.trackKey, nextMetadata.analysisVersion].every(value => value === null || typeof value === 'string')) {
      throw new Error('楽曲の描画情報が不正です。');
    }
    const nextSettings = Object.freeze({ ...settings });
    const instance = this.createStyle(nextSettings, seed, width, height);
    this.style?.dispose();
    this.style = instance; this.settings = nextSettings;
    this.metadata = Object.freeze(nextMetadata);
    this.seed = seed; this.frame = 0;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    // Assigning the dimensions also resets each layer's paint/clip state.
    for (const layer of Object.values(this.layers)) {
      layer.canvas.width = width; layer.canvas.height = height;
    }
    const background = this.layers.background.ctx;
    const gradient = background.createLinearGradient(0, 0, width, height);
    const colors = themes[settings.theme].background;
    gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
    background.fillStyle = gradient; background.fillRect(0, 0, width, height);
    this.present();
  }

  reset(seed = this.seed, metadata = this.metadata) {
    this.initialize(seed, metadata, this.settings, this.canvas.width, this.canvas.height);
  }

  configure(patch, size = [this.canvas.width, this.canvas.height]) {
    if (Object.keys(patch).some(key => !['style', 'theme', 'strength', 'trail'].includes(key))) {
      throw new Error('未対応の描画設定です。');
    }
    this.initialize(this.seed, this.metadata, { ...this.settings, ...patch }, ...size);
  }

  step(features, { present = true } = {}) {
    this.assertActive();
    if (this.metadata.duration !== null && this.frame >= frameCount(this.metadata.duration, this.metadata.duration)) return false;
    const dt = stepDuration(this.frame, this.metadata.duration);
    const drawing = this.layers.drawing.ctx, effects = this.layers.effects.ctx;
    const fadeTicks = this.frame % 4 + dt * STEP_RATE;
    const finalStep = this.metadata.duration !== null && this.frame + 1 >= frameCount(this.metadata.duration, this.metadata.duration);
    // Batch four ticks to prevent 8-bit alpha rounding from leaving a gray pigment floor.
    // The phase comes from frame, so snapshots and partial song endings need no extra clock.
    if (this.settings.trail === 'fade' && (this.frame % 4 === 3 || finalStep)) {
      drawing.save();
      drawing.globalCompositeOperation = 'destination-out';
      drawing.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - .018, fadeTicks)})`;
      drawing.fillRect(0, 0, this.canvas.width, this.canvas.height);
      drawing.restore();
    }
    effects.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawing.save(); effects.save();
    try {
      this.style.step({
        frameIndex: this.frame, time: this.frame / STEP_RATE, dt,
        features: Object.freeze({ ...features }),
        layers: Object.freeze({ drawing, effects }),
      });
    } finally { drawing.restore(); effects.restore(); }
    this.frame++;
    if (present) this.present();
    return true;
  }

  // The preview, PNG and future recorder all consume this same output canvas.
  present() {
    this.assertActive();
    const c = this.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.layers.background.canvas, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.layers.drawing.canvas, 0, 0);
    c.drawImage(this.layers.effects.canvas, 0, 0);
    c.restore();
  }

  snapshotKey() {
    return JSON.stringify({
      renderer: RENDER_VERSION, styleVersion: this.styles[this.settings.style].version,
      seed: this.seed, settings: this.settings, metadata: this.metadata,
      width: this.canvas.width, height: this.canvas.height,
    });
  }

  snapshot() {
    this.assertActive();
    return {
      key: this.snapshotKey(), frame: this.frame,
      styleState: structuredClone(this.style.snapshot()),
      layers: Object.fromEntries(layerNames.map(name => {
        const copy = this.createCanvas(); copy.width = this.canvas.width; copy.height = this.canvas.height;
        this.copySurface(copy.getContext('2d', { willReadFrequently: true }), this.layers[name].canvas);
        return [name, copy];
      })),
    };
  }

  copySurface(context, source) {
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1; context.globalCompositeOperation = 'copy';
      context.drawImage(source, 0, 0);
    } finally { context.restore(); }
  }

  restore(snapshot) {
    this.assertActive();
    const { width, height } = this.canvas;
    const maximum = this.metadata.duration === null ? Infinity : frameCount(this.metadata.duration, this.metadata.duration);
    if (!snapshot || snapshot.key !== this.snapshotKey() || !Number.isSafeInteger(snapshot.frame)
        || snapshot.frame < 0 || snapshot.frame > maximum) {
      throw new Error('この曲・設定では描画状態を復元できません。');
    }
    // Validate and copy everything before touching the active state or pixels.
    const pixels = {};
    for (const name of layerNames) {
      const image = snapshot.layers?.[name];
      if (!image || image.width !== width || image.height !== height || typeof image.getContext !== 'function'
          || !image.getContext('2d', { willReadFrequently: true })) {
        throw new Error('描画レイヤーの復元データが不正です。');
      }
      pixels[name] = this.createCanvas(); pixels[name].width = width; pixels[name].height = height;
      this.copySurface(pixels[name].getContext('2d', { willReadFrequently: true }), image);
    }
    const candidate = this.createStyle(this.settings, this.seed, width, height);
    try { candidate.restore(structuredClone(snapshot.styleState)); }
    catch (error) { candidate.dispose(); throw error; }
    this.style.dispose(); this.style = candidate;
    for (const name of layerNames) {
      this.copySurface(this.layers[name].ctx, pixels[name]);
      pixels[name].width = 0; pixels[name].height = 0;
    }
    this.frame = snapshot.frame;
    this.present();
  }

  dispose() {
    if (this.disposed) return;
    this.style.dispose();
    for (const layer of Object.values(this.layers)) { layer.canvas.width = 0; layer.canvas.height = 0; }
    this.disposed = true;
  }
}
