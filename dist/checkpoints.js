export const CACHE_LIMIT_BYTES = 48 * 1024 * 1024;
export const CACHE_ENTRY_LIMIT = 4;
export const CHECKPOINT_FRAMES = 450; // 15 seconds at the shared 30 Hz rate.

function release(snapshot) {
  for (const canvas of Object.values(snapshot?.layers ?? {})) { canvas.width = 0; canvas.height = 0; }
}

// Owns only independent snapshot canvases, never the active renderer surfaces.
export class CheckpointCache {
  constructor(renderer, { maxBytes = CACHE_LIMIT_BYTES, maxEntries = CACHE_ENTRY_LIMIT } = {}) {
    this.renderer = renderer; this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.entries = []; this.bytes = 0; this.key = null; this.clock = 0; this.hits = 0; this.misses = 0;
  }
  sync() {
    const key = this.renderer.snapshotKey();
    if (key !== this.key) { this.clear(); this.key = key; }
  }
  clear() {
    this.entries.forEach(entry => release(entry.snapshot)); this.entries = []; this.bytes = 0;
    this.key = null; this.hits = this.misses = 0;
  }
  find(target) {
    this.sync();
    const best = this.entries.filter(entry => entry.snapshot.frame <= target)
      .sort((a, b) => b.snapshot.frame - a.snapshot.frame)[0];
    if (!best) { this.misses++; return null; }
    best.used = ++this.clock; this.hits++; return best.snapshot;
  }
  remember() {
    this.sync();
    const r = this.renderer;
    if (r.frame === 0 || this.maxEntries < 1) return false;
    const duplicate = this.entries.find(entry => entry.snapshot.frame === r.frame);
    if (duplicate) { duplicate.used = ++this.clock; return true; }
    const surfaces = r.canvas.width * r.canvas.height * 4 * 3;
    if (surfaces > this.maxBytes) return false;
    let snapshot;
    try {
      snapshot = r.snapshot();
      const bytes = surfaces + JSON.stringify(snapshot.styleState).length * 2;
      if (bytes > this.maxBytes) { release(snapshot); return false; }
      while (this.entries.length >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        this.entries.sort((a, b) => a.used - b.used);
        const removed = this.entries.shift(); this.bytes -= removed.bytes; release(removed.snapshot);
      }
      this.entries.push({ snapshot, bytes, used: ++this.clock }); this.bytes += bytes; return true;
    } catch {
      release(snapshot); return false; // Caching is optional; a failed copy must not stop playback.
    }
  }
  get stats() { return { entries: this.entries.length, bytes: this.bytes, maxBytes: this.maxBytes, maxEntries: this.maxEntries, hits: this.hits, misses: this.misses }; }
}
