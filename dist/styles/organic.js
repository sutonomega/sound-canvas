import { palettes } from '../themes.js';

export const organicStyle = Object.freeze({
  id: 'organic', version: 'organic-2', maxTransient: 64,
  label: '有機的な曲線', description: '音に寄り添う、なめらかな光の軌跡', symbol: '∿',
  create() {
    let width, height, scale, settings, randomState, phase, offsets;
    let travel = 0, detailCredit = 0, last = [], pulses = [];
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    return {
      reset(options) {
        ({ width, height, settings } = options);
        scale = Math.min(width, height);
        randomState = options.seed >>> 0;
        phase = random() * Math.PI * 2;
        offsets = Array.from({ length: 7 }, (_, i) => i * .53 + random() * .16);
        travel = 0; detailCredit = 0; last = []; pulses = [];
      },
      step({ dt, features: a, layers }) {
        const c = layers.drawing, e = layers.effects, strength = settings.strength;
        const v = Math.min(1.4, a.volume * strength), b = Math.min(1, a.bass * strength);
        const m = Math.min(1, a.mid * strength), h = Math.min(1, a.high * strength);
        const intensity = Math.min(1, (a.intensity ?? 0) * strength);
        const audible = v > .005, colors = palettes[settings.theme];
        // A music-driven clock is part of the saved simulation state.
        travel += dt * (.16 + m * .28 + intensity * .18) * (.6 + strength * .4);
        const margin = Math.max(2, scale * .1);
        const fieldX = Math.max(0, width / 2 - margin), fieldY = Math.max(0, height / 2 - margin);
        const centerX = width / 2 + fieldX * .1 * Math.sin(travel * .43 + phase);
        const centerY = height / 2 + fieldY * .1 * Math.cos(travel * .31 - phase);
        const spread = .48 + b * .28 + intensity * .08;
        const ease = 1 - Math.exp(-dt * (2 + m * 3));
        pulses = pulses.filter(pulse => (pulse.age += dt) < pulse.life);
        // Overpainting colored strokes, rather than additive accumulation, avoids
        // turning repeated crossings into a white patch during a long song.
        c.globalCompositeOperation = 'source-over'; c.lineCap = 'round';
        for (let j = 0; j < 7; j++) {
          const q = travel + phase + offsets[j];
          const targetX = centerX + fieldX * spread * (.7 * Math.sin(q * .89 + .22 * Math.sin(q * .41 + phase)) + .22 * Math.cos(q * 1.87 + j * .17));
          const targetY = centerY + fieldY * spread * (.7 * Math.cos(q * .61 + j * .19) + .22 * Math.sin(q * 1.39 + phase));
          const previous = last[j] || [targetX, targetY];
          const x = previous[0] + (targetX - previous[0]) * ease;
          const y = previous[1] + (targetY - previous[1]) * ease;
          const dx = x - previous[0], dy = y - previous[1], distance = Math.hypot(dx, dy);
          const hue = colors[j % colors.length];
          if (audible && distance > 1e-8) {
            const bend = Math.min(scale * .003, distance * .35) * Math.sin(q * 2.7) * m;
            const cpX = (previous[0] + x) / 2 - dy / distance * bend;
            const cpY = (previous[1] + y) / 2 + dx / distance * bend;
            const lineWidth = Math.max(.12, scale * (.0011 + v * .0026));
            const coverage = Math.min(1, distance / Math.max(.1, scale * .0015));
            const alpha = (.065 + Math.sqrt(v) * .18) * (.5 + coverage * .5);
            c.beginPath(); c.moveTo(...previous); c.quadraticCurveTo(cpX, cpY, x, y);
            c.strokeStyle = `hsla(${hue},85%,58%,${alpha * .18})`;
            c.lineWidth = lineWidth * 3.4 + scale * .0015; c.stroke();
            c.strokeStyle = `hsla(${hue},85%,${54 + v * 10}%,${alpha})`;
            c.lineWidth = lineWidth; c.stroke();
          }
          last[j] = [x, y];
        }

        if (audible && h > .12) {
          detailCredit += dt * h * (3 + intensity * 9);
          while (detailCredit >= 1) {
            detailCredit -= 1;
            const j = Math.floor(random() * last.length), point = last[j];
            const radius = Math.max(.18, scale * (.0006 + h * .0011));
            c.fillStyle = `hsla(${colors[j % colors.length]},85%,${62 + v * 8}%,${.12 + h * .18})`;
            c.beginPath(); c.arc(point[0], point[1], radius, 0, Math.PI * 2); c.fill();
          }
        }
        if (audible && a.beat) {
          const count = 2 + Math.floor(intensity * 5);
          for (let n = 0; n < count; n++) {
            const j = Math.floor(n * 7 / count), point = last[j];
            pulses.push({ x: point[0], y: point[1], hue: colors[j % colors.length], age: 0,
              life: .4 + random() * .4,
              radius: Math.max(.35, scale * (.0018 + b * .004)) * (.8 + random() * .2),
            });
          }
        }
        pulses = pulses.slice(-64);
        e.globalCompositeOperation = 'source-over';
        for (const pulse of pulses) {
          const remaining = 1 - pulse.age / pulse.life;
          const radius = pulse.radius * (1 + pulse.age * .7), glowRadius = radius * 4;
          const glow = e.createRadialGradient(pulse.x, pulse.y, 0, pulse.x, pulse.y, glowRadius);
          glow.addColorStop(0, `hsla(${pulse.hue},90%,76%,${remaining * .42})`);
          glow.addColorStop(.3, `hsla(${pulse.hue},90%,65%,${remaining * .14})`);
          glow.addColorStop(1, `hsla(${pulse.hue},90%,58%,0)`);
          e.fillStyle = glow;
          e.fillRect(pulse.x - glowRadius, pulse.y - glowRadius, glowRadius * 2, glowRadius * 2);
        }
      },
      snapshot() { return structuredClone({ last, pulses, randomState, travel, detailCredit }); },
      restore(state) {
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || !Array.isArray(state.last) || state.last.length > 7
            || state.last.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))
            || !Array.isArray(state.pulses) || state.pulses.length > 64
            || state.pulses.some(pulse => !['x', 'y', 'hue', 'age', 'life', 'radius'].every(key => finite(pulse[key]))
              || pulse.age < 0 || pulse.life <= pulse.age || pulse.radius <= 0)
            || !Number.isInteger(state.randomState) || state.randomState < 0 || state.randomState > 0xffffffff
            || !finite(state.travel) || state.travel < 0 || !finite(state.detailCredit)
            || state.detailCredit < 0 || state.detailCredit >= 1) {
          throw new Error('曲線スタイルの復元データが不正です。');
        }
        ({ last, pulses, randomState, travel, detailCredit } = structuredClone(state));
      },
      dispose() { last = []; pulses = []; offsets = []; },
    };
  },
});
