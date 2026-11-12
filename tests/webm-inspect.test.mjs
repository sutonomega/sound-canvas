import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demuxWebM, soundOnsets, imageMetrics } from './webm-inspect.js';
const element = (id, body) => new Uint8Array([...id, 0x80 | body.length, ...body]);
const combine = (...items) => new Uint8Array(items.flatMap(x => [...x]));
function fixture({ lacing = 0, blockGroup = false, codecDelay = 0 } = {}) {
  const track = element([0xae], combine(element([0xd7], [1]), element([0x83], [1]), element([0x86], new TextEncoder().encode('V_VP8')),
    element([0x56, 0xaa], [codecDelay >> 16 & 255, codecDelay >> 8 & 255, codecDelay & 255])));
  const block = element([blockGroup ? 0xa1 : 0xa3], [0x81, 0xff, 0xf6, 0x80 | lacing, 0]); // track 1, relative -10 ticks
  return element([0x18, 0x53, 0x80, 0x67], combine(element([0x16, 0x54, 0xae, 0x6b], track),
    element([0x1f, 0x43, 0xb6, 0x75], combine(element([0xe7], [3, 232]), blockGroup ? element([0xa0], block) : block))));
}
test('WebM timestamps combine cluster, signed block offset and codec delay once', () => {
  const file = demuxWebM(fixture({ codecDelay: 1000000 })); assert.equal(file.packets[0].timestamp, 989000); assert.equal(file.packets[0].track, 1);
});
test('BlockGroup video is decoded and key frames are identified from VP8 payload', () => {
  const file = demuxWebM(fixture({ blockGroup: true })); assert.equal(file.packets.length, 1); assert.equal(file.packets[0].key, true);
});
test('lacing is rejected rather than misinterpreted as one frame', () => { assert.throws(() => demuxWebM(fixture({ lacing: 2 })), /lacing/); });
test('malformed and truncated data are rejected', () => {
  assert.throws(() => demuxWebM(new Uint8Array([0]))); assert.throws(() => demuxWebM(fixture().slice(0, -1)));
});
test('the saved real WebM contains timestamped video and Opus packets', () => {
  const file = demuxWebM(readFileSync(new URL('../docs/assets/webm-sample.webm', import.meta.url)));
  const video = file.tracks.find(t => t.type === 1), audio = file.tracks.find(t => t.type === 2);
  assert.equal(video.codec, 'V_VP8'); assert.equal(audio.codec, 'A_OPUS');
  assert.deepEqual(video.colorSpace, { matrix: 'bt709', fullRange: true, transfer: 'iec61966-2-1', primaries: 'bt709' });
  assert.ok(file.packets.filter(p => p.track === video.number).length > 30); assert.ok(file.packets.filter(p => p.track === audio.number).length > 30);
});
test('audio onset times use the packet presentation time and sample position', () => {
  const values = new Float32Array(1000); values.fill(.5, 120, 130); values.fill(.5, 720, 730);
  const times = soundOnsets([{ timestamp: 50000, rate: 1000, values }]);
  assert.equal(times.length, 2); assert.ok(Math.abs(times[0] - .17) < 1e-9); assert.ok(Math.abs(times[1] - .77) < 1e-9);
});
test('quality metrics reject a missing foreground even with an almost unchanged background', () => {
  const background = new Uint8ClampedArray(100 * 100 * 4); for (let i = 3; i < background.length; i += 4) background[i] = 255;
  const expected = background.slice(); for (let i = 400; i < 800; i += 4) expected[i] = expected[i + 1] = expected[i + 2] = 200;
  const lost = imageMetrics(expected, background, background, 100, 100); assert.equal(lost.foregroundRecall, 0); assert.ok(lost.foregroundPsnr < 20);
  const same = imageMetrics(expected, expected, background, 100, 100); assert.equal(same.foregroundRecall, 1); assert.equal(same.psnr, 100);
});
