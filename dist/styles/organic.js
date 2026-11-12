import { palettes } from '../themes.js';

// Each instance owns its previous points, pulse lifetimes and random state.
export const organicStyle = Object.freeze({
  id: 'organic', version: 'organic-1',
  create() {
    let width, height, phase, settings, randomState, last = [], pulses = [];
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    return {
      reset(options) {
        ({ width, height, settings } = options);
        phase = (options.seed % 10000) / 1000;
        randomState = options.seed >>> 0;
        last = []; pulses = [];
      },
      step({ time, dt, features: a, layers }) {
        const c = layers.drawing, e = layers.effects;
        const v = a.volume * settings.strength, b = a.bass * settings.strength;
        const m = a.mid * settings.strength, colors = palettes[settings.theme];
        pulses = pulses.filter(pulse => (pulse.age += dt) < pulse.life);
        c.globalCompositeOperation = 'lighter';
        for (let j = 0; j < 7; j++) {
          const q = time * .23 + j * .9 + phase;
          const x = width * (.5 + .29 * Math.sin(q * .83 + .6 * Math.sin(time * .11 + phase)) + .085 * Math.cos(q * 2.1 + j));
          const y = height * (.5 + .29 * Math.cos(q * .61 + j * .24) + .09 * Math.sin(q * 1.7));
          const previous = last[j] || [x, y], hue = colors[j % colors.length];
          if (v > .005) {
            const width = .6 + v * 2.8;
            c.beginPath(); c.moveTo(...previous);
            c.quadraticCurveTo((previous[0] + x) / 2 + Math.sin(q * 3) * m * 8, (previous[1] + y) / 2, x, y);
            // Layered strokes avoid an expensive per-path blur on full-size CPU canvases.
            c.strokeStyle = `hsla(${hue},85%,62%,${.008 + v * .018})`;
            c.lineWidth = width + 5 + b * 3; c.stroke();
            c.strokeStyle = `hsla(${hue},85%,68%,${Math.min(.5, .035 + v * .16)})`;
            c.lineWidth = width;
            c.stroke();
            if (a.beat) pulses.push({ x, y, hue, age: 0, life: .6 + random() * .4, radius: 1 + b * 2 + random() });
          }
          last[j] = [x, y];
        }
        pulses = pulses.slice(-64);
        e.globalCompositeOperation = 'lighter';
        for (const pulse of pulses) {
          const remaining = 1 - pulse.age / pulse.life;
          const radius = pulse.radius * (1 + pulse.age), glowRadius = radius * 4;
          const glow = e.createRadialGradient(pulse.x, pulse.y, 0, pulse.x, pulse.y, glowRadius);
          glow.addColorStop(0, `hsla(${pulse.hue},90%,80%,${remaining * .4})`);
          glow.addColorStop(.3, `hsla(${pulse.hue},90%,70%,${remaining * .12})`);
          glow.addColorStop(1, `hsla(${pulse.hue},90%,60%,0)`);
          e.fillStyle = glow;
          e.fillRect(pulse.x - glowRadius, pulse.y - glowRadius, glowRadius * 2, glowRadius * 2);
        }
      },
      snapshot() {
        return structuredClone({ last, pulses, randomState });
      },
      restore(state) {
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || !Array.isArray(state.last) || state.last.length > 7
            || state.last.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))
            || !Array.isArray(state.pulses) || state.pulses.length > 64
            || state.pulses.some(pulse => !['x', 'y', 'hue', 'age', 'life', 'radius'].every(key => finite(pulse[key]))
              || pulse.age < 0 || pulse.life <= pulse.age || pulse.radius <= 0)
            || !Number.isInteger(state.randomState) || state.randomState < 0 || state.randomState > 0xffffffff) {
          throw new Error('曲線スタイルの復元データが不正です。');
        }
        ({ last, pulses, randomState } = structuredClone(state));
      },
      dispose() { last = []; pulses = []; },
    };
  },
});
