import { styleRegistry } from './styles/index.js';
import { themes } from './themes.js';

export const aspectRatios = Object.freeze({
  portrait: Object.freeze({ label: '9:16', width: 720, height: 1280 }),
  landscape: Object.freeze({ label: '16:9', width: 1280, height: 720 }),
  square: Object.freeze({ label: '1:1', width: 1080, height: 1080 }),
});

// Reflect the committed renderer settings instead of maintaining a second selection state.
export class SettingsPanel {
  constructor(document, configure) {
    this.document = document; this.configure = configure; this.strengthDraft = null;
    const $ = id => document.getElementById(id); this.$ = $;
    for (const definition of Object.values(styleRegistry)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'style-card';
      button.dataset.style = definition.id; button.setAttribute('aria-label', definition.label);
      const symbol = document.createElement('span'); symbol.className = 'curve'; symbol.textContent = definition.symbol;
      symbol.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div'), name = document.createElement('strong'), description = document.createElement('small');
      name.textContent = definition.label; description.textContent = definition.description; content.append(name, description);
      const check = document.createElement('b'); check.className = 'style-check'; check.setAttribute('aria-hidden', 'true');
      button.append(symbol, content, check); button.onclick = () => configure({ style: definition.id });
      $('styles').append(button);
    }
    for (const id of ['theme', 'trail', 'strength']) {
      $(id).onchange = () => {
        this.strengthDraft = null;
        configure({ [id]: id === 'strength' ? Number($(id).value) / 100 : $(id).value });
      };
    }
    $('strength').oninput = () => {
      this.strengthDraft = $('strength').value; this.showStrength(this.strengthDraft);
    };
    $('strength').onpointercancel = $('strength').onblur = () => {
      this.strengthDraft = null;
      if (this.renderer) this.update(this.renderer, this.state);
    };
    document.querySelectorAll('[data-ratio]').forEach(button => button.onclick = () => {
      const ratio = aspectRatios[button.dataset.ratio]; configure({}, [ratio.width, ratio.height]);
    });
  }

  showStrength(value) {
    const label = `${value}%`;
    if (this.$('strength-value').value !== label) this.$('strength-value').value = label;
    if (this.$('strength').getAttribute('aria-valuetext') !== label) this.$('strength').setAttribute('aria-valuetext', label);
  }

  update(renderer, { locked = false, restoring = false } = {}) {
    this.renderer = renderer; this.state = { locked, restoring };
    const $ = this.$, settings = renderer.settings;
    if (locked) this.strengthDraft = null;
    for (const id of ['theme', 'trail', 'strength']) $(id).disabled = locked;
    for (const id of ['theme', 'trail']) if ($(id).value !== settings[id]) $(id).value = settings[id];
    const strength = this.strengthDraft ?? String(Math.round(settings.strength * 100));
    if ($('strength').value !== strength) $('strength').value = strength;
    this.showStrength(strength);
    this.document.querySelectorAll('[data-style]').forEach(button => {
      const selected = settings.style === button.dataset.style;
      button.disabled = locked;
      if (button.getAttribute('aria-pressed') !== String(selected)) button.setAttribute('aria-pressed', String(selected));
      const check = button.querySelector('.style-check'), mark = selected ? '✓' : '';
      if (check.textContent !== mark) check.textContent = mark;
    });
    this.document.querySelectorAll('[data-ratio]').forEach(button => {
      const ratio = aspectRatios[button.dataset.ratio];
      const selected = ratio.width === renderer.canvas.width && ratio.height === renderer.canvas.height;
      button.disabled = locked; button.classList.toggle('selected', selected);
      if (button.getAttribute('aria-pressed') !== String(selected)) button.setAttribute('aria-pressed', String(selected));
    });
    const dimensions = `${renderer.canvas.width} × ${renderer.canvas.height}`;
    if ($('dimensions').textContent !== dimensions) $('dimensions').textContent = dimensions;
    if (this.theme !== settings.theme) {
      this.theme = settings.theme; const swatches = $('swatches'); swatches.replaceChildren();
      for (const hue of themes[settings.theme].colors) {
        const swatch = this.document.createElement('i'); swatch.style.backgroundColor = `hsl(${hue}, 85%, 60%)`;
        swatches.append(swatch);
      }
    }
    const busy = String(locked || restoring);
    if ($('settings-panel').getAttribute('aria-busy') !== busy) $('settings-panel').setAttribute('aria-busy', busy);
    const note = locked ? '解析中は設定を変更できません。' : restoring ? '選んだ設定で描き直しています…' : '設定は曲全体に反映されます。';
    if ($('settings-note').textContent !== note) $('settings-note').textContent = note;
  }
}
