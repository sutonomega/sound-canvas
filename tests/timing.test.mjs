import test from 'node:test';
import assert from 'node:assert/strict';
import { frameCount, stepDuration, STEP_RATE } from '../dist/timing.js';

test('all exact 30 Hz boundaries through ten minutes select exactly that frame', () => {
  for (let frame = 0; frame <= 18000; frame++) {
    const time = frame / STEP_RATE;
    assert.equal(frameCount(time, 601), frame, `position ${frame}`);
    assert.equal(frameCount(time, time), frame, `end ${frame}`);
  }
});
test('a real fractional interval is kept before and after every boundary', () => {
  for (const frame of [1, 31, 123, 245, 18000, 2592000]) {
    const time = frame / STEP_RATE;
    assert.equal(frameCount(time - 1e-7, time + 1), frame - 1);
    assert.equal(frameCount(time + 1e-7, time + 1), frame);
    assert.equal(frameCount(time + 1e-7, time + 1e-7), frame + 1);
    assert.ok(stepDuration(frame, time + 1e-7) > 0);
  }
});
test('short songs and zero have correct final partial intervals', () => {
  assert.equal(frameCount(0, 0), 0); assert.equal(frameCount(0, .001), 0);
  assert.equal(frameCount(.001, .001), 1); assert.equal(stepDuration(0, .001), .001);
  assert.equal(frameCount(.11, .11), 4); assert.ok(Math.abs(stepDuration(3, .11) - .01) < 1e-12);
});
test('aligned sample counts do not create empty frames at supported sample rates', () => {
  for (const rate of [8000, 22050, 44100, 48000, 96000]) {
    for (const seconds of [1, 3, 11, 60]) {
      const length = rate * seconds, duration = length / rate;
      assert.equal(frameCount(duration, duration), seconds * STEP_RATE);
      assert.ok(stepDuration(frameCount(duration, duration) - 1, duration) > 0);
    }
  }
});
