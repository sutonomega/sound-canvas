import { palettes } from '../themes.js';

const TAU = Math.PI * 2;
export const WATERCOLOR_BLOOM_LIMIT = 18;
export const watercolorStyle = Object.freeze({
  id: 'watercolor', version: 'watercolor-1', maxTransient: WATERCOLOR_BLOOM_LIMIT,
  label: '流体・水彩', description: '音にほどける、柔らかな色のにじみ', symbol: '◌',
  create() {
    let width, height, scale, settings, randomState, phase, colorOffset;
    let clock = 0, stampCredit = 0, blooms = [];
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    // Smooth, seed-derived harmonics deform the edge without per-frame random jitter.
    const wash = (c, x, y, radius, hue, alpha, shape) => {
      const gradient = c.createRadialGradient(x, y, 0, x, y, radius * 1.12);
      gradient.addColorStop(0, `hsla(${hue},78%,52%,${alpha * .35})`);
      gradient.addColorStop(.55, `hsla(${hue},82%,56%,${alpha})`);
      gradient.addColorStop(1, `hsla(${hue},85%,58%,0)`);
      c.fillStyle = gradient; c.beginPath();
      for (let i = 0; i <= 48; i++) {
        const angle = i / 48 * TAU;
        const r = radius * (1 + .065 * Math.sin(angle * 3 + shape) + .045 * Math.sin(angle * 5 - shape * .7));
        const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath(); c.fill();
    };
    return {
      reset(options) {
        ({ width, height, settings } = options); scale = Math.min(width, height);
        randomState = options.seed >>> 0; phase = random() * TAU;
        colorOffset = Math.floor(random() * palettes[settings.theme].length);
        clock = 0; stampCredit = 0; blooms = [];
      },
      step({ dt, features: a, layers }) {
        const c = layers.drawing, e = layers.effects, strength = settings.strength;
        const v = Math.min(1.4, a.volume * strength), b = Math.min(1, a.bass * strength);
        const m = Math.min(1, a.mid * strength), h = Math.min(1, a.high * strength);
        const intensity = Math.min(1, (a.intensity ?? 0) * strength), audible = v > .005;
        const colors = palettes[settings.theme];
        clock += dt * (.16 + m * .26 + intensity * .19) * (.7 + strength * .3);
        blooms = blooms.filter(bloom => (bloom.age += dt) < bloom.life);
        c.globalCompositeOperation = e.globalCompositeOperation = 'source-over';
        if (audible) {
          stampCredit += dt * (6 + intensity * 6) * (.7 + strength * .3);
          while (stampCredit >= 1) {
            stampCredit -= 1;
            for (let j = 0; j < 3; j++) {
              const t = clock + phase + j * TAU / 3;
              const spread = .13 + b * .12 + intensity * .04;
              const x = width / 2 + width * spread * Math.sin(t * .79 + j);
              const y = height / 2 + height * spread * Math.cos(t * .61 - j * .8);
              const radius = scale * (.024 + b * .047 + intensity * .013) * (.85 + random() * .15);
              const hue = colors[(colorOffset + j) % colors.length];
              const alpha = (.045 + Math.sqrt(v) * .09) * (.75 + intensity * .25);
              wash(c, x, y, radius, hue, alpha, t + random() * .5);
              // Fine pigment speckles remain separate from the broad bass-driven wash.
              for (let n = 0; n < Math.floor(h * 6); n++) {
                const angle = random() * TAU, distance = radius * (.35 + random() * .65);
                c.fillStyle = `hsla(${hue},88%,65%,${.06 + Math.sqrt(v) * .1})`;
                c.beginPath(); c.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance,
                  Math.max(.15, scale * (.0006 + random() * .001)), 0, TAU); c.fill();
              }
            }
          }
          if (a.beat) {
            const t = clock + phase;
            blooms.push({ x: width / 2 + width * .22 * Math.sin(t),
              y: height / 2 + height * .22 * Math.cos(t * .83), age: 0, life: 1.1 + random() * .5,
              radius: scale * (.025 + b * .04), hue: colors[(colorOffset + Math.floor(random() * colors.length)) % colors.length],
              phase: random() * TAU, energy: v });
            blooms = blooms.slice(-WATERCOLOR_BLOOM_LIMIT);
          }
        }
        for (const bloom of blooms) {
          const progress = bloom.age / bloom.life;
          wash(e, bloom.x, bloom.y, bloom.radius * (1 + progress * .5), bloom.hue,
            (1 - progress) * (.08 + Math.sqrt(bloom.energy) * .12), bloom.phase + progress);
        }
      },
      snapshot() { return structuredClone({ clock, stampCredit, blooms, randomState }); },
      restore(state) {
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || !finite(state.clock) || state.clock < 0 || !finite(state.stampCredit)
            || state.stampCredit < 0 || state.stampCredit >= 1
            || !Number.isInteger(state.randomState) || state.randomState < 0 || state.randomState > 0xffffffff
            || !Array.isArray(state.blooms) || state.blooms.length > WATERCOLOR_BLOOM_LIMIT
            || state.blooms.some(p => !['x', 'y', 'age', 'life', 'radius', 'hue', 'phase', 'energy'].every(key => finite(p[key]))
              || p.x < width * .27 || p.x > width * .73 || p.y < height * .27 || p.y > height * .73
              || p.age < 0 || p.age >= p.life || p.life < 1.1 || p.life > 1.6
              || p.radius < scale * .025 || p.radius > scale * .065 + 1e-8
              || p.hue < 0 || p.hue >= 360 || p.phase < 0 || p.phase >= TAU || p.energy < 0 || p.energy > 1.4)) {
          throw new Error('水彩スタイルの復元データが不正です。');
        }
        ({ clock, stampCredit, blooms, randomState } = structuredClone(state));
      },
      dispose() { blooms = []; },
    };
  },
});
