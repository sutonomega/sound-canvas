import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckpointCache, CACHE_LIMIT_BYTES } from '../dist/checkpoints.js';
function fixture(options, size = [720, 1280]) {
  const copies = [], r = { canvas: { width: size[0], height: size[1] }, frame: 0, key: 'track/settings/v1', calls: 0,
    snapshotKey() { return this.key; }, snapshot() {
      this.calls++; const snapshot = { key: this.key, frame: this.frame, styleState: { randomState: 42 },
        layers: Object.fromEntries(['background', 'drawing', 'effects'].map(id => [id, { width: this.canvas.width, height: this.canvas.height }])) };
      copies.push(snapshot); return snapshot;
    } };
  const cache = new CheckpointCache(r, options);
  const store = frame => { r.frame = frame; return cache.remember(); };
  return { r, cache, store, copies };
}
test('cache chooses the nearest earlier snapshot, never a future one', () => {
  const f = fixture(); f.store(450); f.store(900); f.store(1350);
  assert.equal(f.cache.find(1000).frame, 900); assert.equal(f.cache.find(899).frame, 450);
  assert.equal(f.cache.find(200), null); assert.equal(f.cache.stats.hits, 2); assert.equal(f.cache.stats.misses, 1);
});
test('least recently used snapshot surfaces are explicitly released on eviction', () => {
  const f = fixture({ maxEntries: 2 }); f.store(450); f.store(900); f.cache.find(500); f.store(1350);
  assert.equal(f.cache.entries.length, 2); assert.ok(Object.values(f.copies[1].layers).every(c => c.width === 0 && c.height === 0));
  assert.ok(Object.values(f.copies[0].layers).every(c => c.width === 720)); assert.equal(f.r.canvas.width, 720);
});
for (const size of [[720, 1280], [1280, 720], [1080, 1080]]) test(`${size.join('x')}: retained snapshots stay inside the 48 MiB budget`, () => {
  const f = fixture(undefined, size);
  for (let i = 1; i <= 20; i++) { f.store(i * 450); assert.ok(f.cache.bytes <= CACHE_LIMIT_BYTES); assert.ok(f.cache.entries.length <= 4); }
  assert.equal(f.cache.entries.length, size[0] === 1080 ? 3 : 4);
  const alive = f.copies.filter(s => s.layers.drawing.width > 0); assert.equal(alive.length, f.cache.entries.length);
});
test('same frame does not allocate duplicate surfaces', () => {
  const f = fixture(); f.store(450); const bytes = f.cache.bytes; f.store(450);
  assert.equal(f.r.calls, 1); assert.equal(f.cache.bytes, bytes); assert.equal(f.cache.entries.length, 1);
});
test('zero and an oversized surface do not allocate a snapshot', () => {
  const f = fixture({ maxBytes: 10 }); assert.equal(f.store(0), false); assert.equal(f.store(450), false); assert.equal(f.r.calls, 0);
});
test('state size is included and an over-budget snapshot is released', () => {
  const surfaces = 36 * 64 * 4 * 3, f = fixture({ maxBytes: surfaces + 1 }, [36, 64]);
  assert.equal(f.store(450), false); assert.equal(f.cache.bytes, 0);
  assert.ok(Object.values(f.copies[0].layers).every(c => c.width === 0));
});
test('key changes release all prior frames and reset hit statistics', () => {
  const f = fixture(); f.store(450); f.cache.find(450); f.r.key = 'new-track-or-settings';
  assert.equal(f.cache.find(500), null); assert.equal(f.cache.bytes, 0); assert.equal(f.cache.stats.hits, 0);
  assert.ok(Object.values(f.copies[0].layers).every(c => c.width === 0));
});
test('snapshot-copy failure leaves playback surfaces and prior usable entries intact', () => {
  const f = fixture(); f.store(450); f.r.snapshot = () => { throw new Error('copy failed'); };
  assert.equal(f.store(900), false); assert.equal(f.cache.find(1000).frame, 450); assert.equal(f.r.canvas.width, 720);
});
test('clear releases every owned surface and can be repeated', () => {
  const f = fixture(); f.store(450); f.store(900); f.cache.clear(); f.cache.clear();
  assert.equal(f.cache.bytes, 0); assert.equal(f.cache.entries.length, 0); assert.ok(f.copies.every(s => s.layers.effects.width === 0));
});
