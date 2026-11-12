import test from 'node:test';
import assert from 'node:assert/strict';
import { saveHint, spokenTime, seekKeyTime, FlowFocus } from '../dist/usability.js';

test('save guidance distinguishes empty, loading, restore, audio start, PNG and video states', () => {
  const studio = { audio: { buffer: null } }, png = { busy: false }, video = { busy: false };
  assert.match(saveHint(studio, png, video), /先に楽曲/);
  studio.loading = true; assert.match(saveHint(studio, png, video), /読み込み・解析/);
  studio.loading = false; studio.audio.buffer = {}; studio.restoring = true; assert.match(saveHint(studio, png, video), /描き直し/);
  studio.restoring = false; studio.starting = true; assert.match(saveHint(studio, png, video), /再生の準備/);
  studio.starting = false; assert.equal(saveHint(studio, png, video), '');
  png.busy = true; assert.match(saveHint(studio, png, video), /PNG/);
  png.busy = false; video.busy = true; studio.restoring = true; assert.match(saveHint(studio, png, video), /MV/);
});

test('seek time has readable Japanese units and handles a missing duration', () => {
  assert.equal(spokenTime(125.99), '2分5秒'); assert.equal(spokenTime(0), '0分0秒');
  for (const value of [-1, NaN, Infinity, undefined]) assert.equal(spokenTime(value), '0分0秒');
});

function fixture() {
  const document = { body: {} }; document.activeElement = document.body;
  const element = () => ({ disabled: false, hidden: false, focus() { document.activeElement = this; } });
  return { document, source: element(), cancel: element(), save: element(), other: element(), flow: new FlowFocus(document) };
}
test('keyboard seeking uses seconds, supports ten-second jumps, and clamps to the song', () => {
  assert.equal(seekKeyTime('ArrowRight', 2, 36), 3);
  assert.equal(seekKeyTime('ArrowLeft', 2, 36), 1);
  assert.equal(seekKeyTime('ArrowRight', 2, 36, true), 12);
  assert.equal(seekKeyTime('PageUp', 2, 36), 12);
  assert.equal(seekKeyTime('PageDown', 2, 36), 0);
  assert.equal(seekKeyTime('ArrowRight', 35.5, 36), 36);
  assert.equal(seekKeyTime('Enter', 2, 36), null);
});
test('an export transfers disabled source focus to cancel, then to its save link', () => {
  const f = fixture(); f.document.activeElement = f.source; f.source.disabled = true;
  f.flow.update('png', f.source, { cancel: f.cancel, complete: () => f.save });
  assert.equal(f.document.activeElement, f.cancel);
  f.cancel.hidden = true; f.flow.update(null, f.cancel); assert.equal(f.document.activeElement, f.save);
});
test('completion preserves focus when the user has moved elsewhere', () => {
  const f = fixture(); f.source.disabled = true; f.flow.update('video', f.source, { cancel: f.cancel, complete: () => f.save });
  f.other.focus(); f.flow.update(null, f.other); assert.equal(f.document.activeElement, f.other);
});
test('repeated progress never steals focus and disabled completion targets are ignored', () => {
  const f = fixture(); f.source.disabled = true; f.flow.update('png', f.source, { cancel: f.cancel, complete: () => f.save });
  f.other.focus(); f.flow.update('png', f.other, { cancel: f.cancel }); assert.equal(f.document.activeElement, f.other);
  f.cancel.focus(); f.save.disabled = true; f.flow.update(null, f.cancel); assert.equal(f.document.activeElement, f.cancel);
});
test('load completion can move a removed demo button to playback without forcing focus during load', () => {
  const f = fixture(); f.source.focus(); f.flow.update('load', f.source, { cancel: f.cancel, complete: () => f.save });
  assert.equal(f.document.activeElement, f.source);
  f.document.activeElement = f.document.body; f.flow.update(null, f.document.body); assert.equal(f.document.activeElement, f.save);
});
test('settings and seek keep focus throughout a restore while their control remains enabled', () => {
  const f = fixture(); f.source.focus(); f.flow.update('restore', f.source, { cancel: f.cancel, complete: () => f.save });
  f.flow.update(null, f.source); assert.equal(f.document.activeElement, f.source);
});
