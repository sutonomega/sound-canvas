import { palettes } from '../themes.js';

export const PARTICLE_LIMIT = 256;
export const PARTICLE_GLOW_LIMIT = 32;
const TAU = Math.PI * 2;

export const particleStyle = Object.freeze({
  id: 'particles', version: 'particles-1', maxTransient: PARTICLE_LIMIT,
  label: '粒子アート', description: '高音できらめき、低音で広がる光の粒子', symbol: '⁙',
  create() {
    let width, height, scale, margin, settings, randomState, phase, colorOffset;
    let clock = 0, emissionCredit = 0, particles = [];
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    const spawn = (v, b, h, intensity) => {
      if (particles.length >= PARTICLE_LIMIT) return;
      const source = Math.floor(random() * 3), t = clock + phase + source * TAU / 3;
      const x = width / 2 + width * .16 * Math.cos(t) * (.6 + b * .4) + (random() - .5) * scale * .03;
      const y = height / 2 + height * .16 * Math.sin(t * .83 + source) * (.6 + b * .4) + (random() - .5) * scale * .03;
      const angle = random() * TAU, speed = scale * (.018 + b * .1 + intensity * .035) * (.55 + random() * .45);
      particles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, life: 1.2 + random() * 1.8,
        radius: Math.max(.18, scale * (.0012 + random() * .0018) * (1 - h * .6)),
        hue: palettes[settings.theme][(colorOffset + Math.floor(random() * palettes[settings.theme].length)) % palettes[settings.theme].length],
        energy: v, sparkle: h, phase: random() * TAU, glow: random() < .18 + intensity * .12,
      });
    };
    return {
      reset(options) {
        ({ width, height, settings } = options); scale = Math.min(width, height); margin = Math.max(2, scale * .04);
        randomState = options.seed >>> 0; phase = random() * TAU;
        colorOffset = Math.floor(random() * palettes[settings.theme].length);
        clock = 0; emissionCredit = 0; particles = [];
      },
      step({ dt, features: a, layers }) {
        const c = layers.drawing, e = layers.effects, strength = settings.strength;
        const v = Math.min(1.4, a.volume * strength), b = Math.min(1, a.bass * strength);
        const m = Math.min(1, a.mid * strength), h = Math.min(1, a.high * strength);
        const intensity = Math.min(1, (a.intensity ?? 0) * strength), audible = v > .005;
        clock += dt * (.18 + m * .22 + intensity * .13) * (.7 + strength * .3);
        particles = particles.filter(particle => particle.age + dt < particle.life);
        if (audible) {
          const rate = (10 + h * 50 + intensity * 30) * (.25 + .75 * Math.min(1, Math.sqrt(v))) * (.7 + strength * .3);
          emissionCredit += dt * rate;
          while (emissionCredit >= 1) { emissionCredit -= 1; spawn(v, b, h, intensity); }
          if (a.beat) for (let n = 0; n < 3 + Math.floor(intensity * 9); n++) spawn(v, b, h, intensity);
        }
        c.globalCompositeOperation = 'source-over'; c.lineCap = 'round';
        e.globalCompositeOperation = 'source-over';
        let glowCount = 0;
        const damping = Math.exp(-dt * .6), speedLimit = scale * .2;
        for (const p of particles) {
          const previousX = p.x, previousY = p.y;
          p.age += dt;
          const dx = p.x - width / 2, dy = p.y - height / 2, distance = Math.max(1, Math.hypot(dx, dy));
          const spin = .08 + m * .12;
          p.vx = (p.vx + (-dx * .12 - dy * spin + dx / distance * scale * .018 * b) * dt) * damping;
          p.vy = (p.vy + (-dy * .12 + dx * spin + dy / distance * scale * .018 * b) * dt) * damping;
          const speed = Math.hypot(p.vx, p.vy);
          if (speed > speedLimit) { p.vx *= speedLimit / speed; p.vy *= speedLimit / speed; }
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x < margin) { p.x = margin; p.vx = Math.abs(p.vx) * .7; }
          if (p.x > width - margin) { p.x = width - margin; p.vx = -Math.abs(p.vx) * .7; }
          if (p.y < margin) { p.y = margin; p.vy = Math.abs(p.vy) * .7; }
          if (p.y > height - margin) { p.y = height - margin; p.vy = -Math.abs(p.vy) * .7; }
          const lifetime = Math.pow(Math.max(0, Math.sin(Math.PI * p.age / p.life)), .7);
          const alpha = (.035 + Math.sqrt(p.energy) * .09) * lifetime;
          c.strokeStyle = `hsla(${p.hue},85%,${54 + p.energy * 10}%,${alpha})`;
          c.lineWidth = Math.max(.12, p.radius * (.6 + p.energy * .6));
          c.beginPath(); c.moveTo(previousX, previousY); c.lineTo(p.x, p.y); c.stroke();
          const twinkle = .75 + .25 * Math.sin(p.age * (5 + p.sparkle * 8) + p.phase);
          const brightness = lifetime * twinkle;
          if (p.glow && glowCount < PARTICLE_GLOW_LIMIT) {
            const radius = p.radius * 4;
            const glow = e.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
            glow.addColorStop(0, `hsla(${p.hue},90%,75%,${brightness * .25})`);
            glow.addColorStop(1, `hsla(${p.hue},90%,60%,0)`);
            e.fillStyle = glow; e.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2); glowCount++;
          }
          e.fillStyle = `hsla(${p.hue},90%,${68 + p.energy * 6}%,${brightness * .3})`;
          e.beginPath(); e.arc(p.x, p.y, p.radius, 0, TAU); e.fill();
        }
      },
      snapshot() { return structuredClone({ clock, emissionCredit, particles, randomState }); },
      restore(state) {
        const finite = value => typeof value === 'number' && Number.isFinite(value);
        if (!state || !finite(state.clock) || state.clock < 0 || !finite(state.emissionCredit)
            || state.emissionCredit < 0 || state.emissionCredit >= 1
            || !Number.isInteger(state.randomState) || state.randomState < 0 || state.randomState > 0xffffffff
            || !Array.isArray(state.particles) || state.particles.length > PARTICLE_LIMIT
            || state.particles.some(p => !['x', 'y', 'vx', 'vy', 'age', 'life', 'radius', 'hue', 'energy', 'sparkle', 'phase'].every(key => finite(p[key]))
              || p.x < margin || p.x > width - margin || p.y < margin || p.y > height - margin
              || Math.hypot(p.vx, p.vy) > scale * .2 + 1e-8
              || p.age < 0 || p.life <= p.age || p.life < 1.2 || p.life > 3
              || p.radius <= 0 || p.radius > Math.max(.18, scale * .003)
              || p.energy < 0 || p.energy > 1.4 || p.sparkle < 0 || p.sparkle > 1
              || p.hue < 0 || p.hue >= 360 || p.phase < 0 || p.phase >= TAU || typeof p.glow !== 'boolean')) {
          throw new Error('粒子スタイルの復元データが不正です。');
        }
        ({ clock, emissionCredit, particles, randomState } = structuredClone(state));
      },
      dispose() { particles = []; },
    };
  },
});
