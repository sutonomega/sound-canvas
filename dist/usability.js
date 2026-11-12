export function saveHint(studio, png, video) {
  if (png.busy) return 'PNGを生成しています。完了を待つか、生成を中止してください。';
  if (video.busy) return 'MVを録画・処理しています。完了を待つか、録画を中止してください。';
  if (studio.loading) return '楽曲の読み込み・解析が終わると保存できます。';
  if (!studio.audio.buffer) return '先に楽曲を読み込むか、デモを体験してください。';
  if (studio.restoring) return '軌跡の描き直しが終わると保存できます。';
  if (studio.starting) return '再生の準備が終わるまでお待ちください。';
  return '';
}

export function spokenTime(time) {
  const seconds = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export function seekKeyTime(key, time, duration, shift = false) {
  const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[key];
  if (!direction) return null;
  const step = shift || key.startsWith('Page') ? 10 : 1;
  return Math.max(0, Math.min(duration, time + direction * step));
}

// Move focus only when the operation disabled/hid the user's control.
// A user who has moved elsewhere keeps their chosen focus.
export class FlowFocus {
  constructor(document) { this.document = document; this.key = null; this.operation = null; }
  update(key, before, { cancel, complete } = {}) {
    if (key === this.key) return;
    const previous = this.operation, active = this.document.activeElement;
    this.key = key; this.operation = key ? { source: before, cancel, complete, recover: key === 'load' || !!before?.disabled } : null;
    const needsReturn = previous && (previous.recover || active === previous.cancel || previous.source?.hidden || previous.source?.closest?.('[hidden]'));
    if (needsReturn && [this.document.body, previous.source, previous.cancel].includes(active)) {
      const target = previous.complete?.();
      if (target && !target.disabled && !target.hidden) target.focus();
    }
    if (key && before?.disabled && cancel && !cancel.disabled && !cancel.hidden) cancel.focus();
  }
}
