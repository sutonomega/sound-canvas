import { palettes } from '../themes.js';

const TAU = Math.PI * 2;
export const geometricStyle = Object.freeze({
  id: 'geometric', version: 'geometric-1',
  label: '幾何学模様', description: '低音で広がる、光のスピログラフ', symbol: '◎',
  create() {
    let width, height, scale, settings, randomState, petals, colorOffset;
    let angles = [], rotation = 0, radius = 0, flash = 0, last = [], rings = [];
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    return {
      reset(options) {
        ({ width, height, settings } = options); scale = Math.min(width, height);
        randomState = options.seed >>> 0;
        const count = [5, 7, 9][Math.floor(random() * 3)];
        petals = [count, count + 2, count - 1];
        const phase = random() * TAU;
        angles = [phase, (phase + .4) % TAU, (phase + .8) % TAU];
        rotation = random() * TAU;
        colorOffset = Math.floor(random() * palettes[settings.theme].length);
        radius = 0; flash = 0; last = []; rings = [];
      },
      step({ dt, features: a, layers }) {
        const c = layers.drawing, e = layers.effects, strength = settings.strength;
        const v = Math.min(1.4, a.volume * strength), b = Math.min(1, a.bass * strength);
        const m = Math.min(1, a.mid * strength), h = Math.min(1, a.high * strength);
        const intensity = Math.min(1, (a.intensity ?? 0) * strength), audible = v > .005;
        const colors = palettes[settings.theme], cx = width / 2, cy = height / 2;
        rings = rings.filter(ring => (ring.age += dt) < ring.life);
        flash *= Math.exp(-dt / .28);
        if (flash < 1e-5) flash = 0;
        if (audible && a.beat) {
          flash = 1;
          rings.push({ age: 0, life: .5 + random() * .3,
            radius: Math.min(scale * (.22 + .14 * b + .025 * intensity) * .8, scale * .31),
            hue: colors[(colorOffset + Math.floor(random() * colors.length)) % colors.length] });
        }
        rings = rings.slice(-24);
        rotation = (rotation + dt * (.025 + intensity * .025 + flash * .55) * (.7 + strength * .3)) % TAU;
        const targetRadius = scale * (.22 + b * .14 + intensity * .025);
        radius = radius === 0 ? targetRadius : radius + (targetRadius - radius) * (1 - Math.exp(-dt * 3));
        c.globalCompositeOperation = 'source-over'; c.lineCap = 'round'; c.lineJoin = 'round';
        for (let j = 0; j < 3; j++) {
          angles[j] = (angles[j] + dt * (.9 + m * .5 + intensity * .35) * (1 + j * .07) * (.7 + strength * .3)) % TAU;
          const t = angles[j], inner = 1 / petals[j], pen = inner * Math.min(.95, .55 + j * .12 + h * .25);
          const localRadius = radius * (1 - j * .09);
          // A bounded hypotrochoid: (1-r) + pen <= 1 for every input.
          const lx = localRadius * ((1 - inner) * Math.cos(t) + pen * Math.cos((petals[j] - 1) * t));
          const ly = localRadius * ((1 - inner) * Math.sin(t) - pen * Math.sin((petals[j] - 1) * t));
          const x = cx + lx * Math.cos(rotation) - ly * Math.sin(rotation);
          const y = cy + lx * Math.sin(rotation) + ly * Math.cos(rotation);
          const previous = last[j] || [x, y], distance = Math.hypot(x - previous[0], y - previous[1]);
          if (audible && distance > 1e-8) {
            const hue = colors[(colorOffset + j) % colors.length];
            const lineWidth = Math.max(.12, scale * (.0008 + v * .0017));
            const alpha = (.05 + Math.sqrt(v) * .14) * (.5 + .5 * Math.min(1, distance / Math.max(.1, scale * .002)));
            c.beginPath(); c.moveTo(...previous); c.lineTo(x, y);
            c.strokeStyle = `hsla(${hue},85%,56%,${alpha * .13})`; c.lineWidth = lineWidth * 3; c.stroke();
            c.strokeStyle = `hsla(${hue},85%,${55 + v * 8}%,${alpha})`; c.lineWidth = lineWidth; c.stroke();
          }
          last[j] = [x, y];
        }
        e.globalCompositeOperation = 'source-over';
        for (const ring of rings) {
          const remaining = 1 - ring.age / ring.life;
          e.beginPath(); e.arc(cx, cy, ring.radius * (1 + ring.age * .22), 0, TAU);
          e.strokeStyle = `hsla(${ring.hue},85%,65%,${remaining * .25})`;
          e.lineWidth = Math.max(.2, scale * .0014 * remaining); e.stroke();
        }
        if (flash > .005) {
          for (let j = 0; j < last.length; j++) {
            e.fillStyle = `hsla(${colors[(colorOffset + j) % colors.length]},90%,75%,${flash * .45})`;
            e.beginPath(); e.arc(...last[j], Math.max(.2, scale * (.002 + b * .002) * flash), 0, TAU); e.fill();
          }
        }
      },
      snapshot() { return structuredClone({ angles, rotation, radius, flash, last, rings, randomState }); },
      restore(state) {
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || !Array.isArray(state.angles) || state.angles.length !== 3
            || !state.angles.every(value => finite(value) && value >= 0 && value < TAU)
            || !finite(state.rotation) || state.rotation < 0 || state.rotation >= TAU
            || !finite(state.radius) || state.radius < 0 || state.radius > scale * .5
            || !finite(state.flash) || state.flash < 0 || state.flash > 1
            || !Array.isArray(state.last) || state.last.length > 3
            || state.last.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))
            || !Array.isArray(state.rings) || state.rings.length > 24
            || state.rings.some(ring => !['age', 'life', 'radius', 'hue'].every(key => finite(ring[key]))
              || ring.age < 0 || ring.life <= ring.age || ring.radius <= 0)
            || !Number.isInteger(state.randomState) || state.randomState < 0 || state.randomState > 0xffffffff) {
          throw new Error('幾何学スタイルの復元データが不正です。');
        }
        ({ angles, rotation, radius, flash, last, rings, randomState } = structuredClone(state));
      },
      dispose() { angles = []; last = []; rings = []; petals = []; },
    };
  },
});
