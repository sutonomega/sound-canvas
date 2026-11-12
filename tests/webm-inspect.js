// Development-only WebM reader for Chromium MediaRecorder VP8/Opus recordings.
// Explicitly rejects lacing and unknown codecs rather than silently measuring the wrong data.
export function demuxWebM(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks = [], packets = []; let scale = 1000000;
  const uint = (a, b) => { let v = 0; for (let i = a; i < b; i++) v = v * 256 + bytes[i]; return v; };
  const vint = (offset, id = false) => {
    if (offset >= bytes.length || bytes[offset] === 0) throw new Error('WebM VINTが不正');
    let n = 1, mask = 128; while (!(bytes[offset] & mask)) { n++; mask >>= 1; }
    if (n > 8 || offset + n > bytes.length) throw new Error('WebM VINTが途中で切れた');
    let value = id ? bytes[offset] : bytes[offset] & (mask - 1), unknown = !id && (bytes[offset] & (mask - 1)) === mask - 1;
    for (let i = 1; i < n; i++) { value = value * 256 + bytes[offset + i]; unknown &&= bytes[offset + i] === 255; }
    return { value, n, unknown };
  };
  const block = (a, b, cluster, simple) => {
    const number = vint(a); const head = a + number.n;
    if (head + 3 > b) throw new Error('WebM Blockが短い');
    const flags = bytes[head + 2]; if (flags & 6) throw new Error('この試験はlacingに未対応');
    const data = bytes.slice(head + 3, b);
    packets.push({ track: number.value, ticks: cluster + view.getInt16(head), key: simple ? !!(flags & 128) : data.length > 0 && !(data[0] & 1), data });
  };
  const scan = (start, end, track = null, cluster = 0) => {
    let offset = start;
    while (offset < end) {
      const id = vint(offset, true); offset += id.n; const size = vint(offset); offset += size.n;
      const stop = size.unknown ? end : offset + size.value;
      if (stop > end || stop < offset) throw new Error('WebM要素が範囲外');
      const k = id.value;
      if (k === 0xae) { const next = { delayNs: 0, channels: 1 }; tracks.push(next); scan(offset, stop, next, cluster); }
      else if ([0x18538067, 0x1549a966, 0x1654ae6b, 0xe0, 0xe1, 0x1f43b675, 0xa0, 0x55b0].includes(k)) scan(offset, stop, track, cluster);
      else if (k === 0x2ad7b1) scale = uint(offset, stop);
      else if (k === 0xe7) cluster = uint(offset, stop);
      else if (k === 0xa3 || k === 0xa1) block(offset, stop, cluster, k === 0xa3);
      else if (track) {
        const names = { 0xd7: 'number', 0x83: 'type', 0xb0: 'width', 0xba: 'height', 0x9f: 'channels', 0x56aa: 'delayNs' };
        if (names[k]) track[names[k]] = uint(offset, stop);
        else if (k === 0x86) track.codec = new TextDecoder().decode(bytes.slice(offset, stop));
        else if (k === 0x63a2) track.private = bytes.slice(offset, stop);
        else if ([0x55b1, 0x55b9, 0x55ba, 0x55bb].includes(k)) {
          const value = uint(offset, stop); track.colorSpace ??= {};
          const fields = { 0x55b1: 'matrix', 0x55b9: 'fullRange', 0x55ba: 'transfer', 0x55bb: 'primaries' };
          const names = k === 0x55ba ? { 1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1' } : { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };
          if (k === 0x55b9) { if (![1, 2].includes(value)) throw new Error('未対応の色範囲'); track.colorSpace.fullRange = value === 2; }
          else { if (!names[value]) throw new Error('未対応の色変換'); track.colorSpace[fields[k]] = names[value]; }
        }
      }
      offset = stop;
    }
  };
  scan(0, bytes.length);
  for (const packet of packets) {
    const track = tracks.find(t => t.number === packet.track); if (!track) throw new Error('WebMのトラック番号が不明');
    packet.timestamp = Math.round((packet.ticks * scale - track.delayNs) / 1000);
  }
  return { tracks, packets, timestampScaleNs: scale };
}

export async function decodeRecording(blob, onVideoFrame) {
  const file = demuxWebM(await blob.arrayBuffer());
  const video = file.tracks.find(t => t.type === 1), audio = file.tracks.find(t => t.type === 2);
  if (video?.codec !== 'V_VP8' || audio?.codec !== 'A_OPUS') throw new Error('この測定はVP8/Opusのみ対応');
  if (!globalThis.VideoDecoder || !globalThis.AudioDecoder) throw new Error('このブラウザでは時刻付きデコードに未対応');
  const sound = []; let failure;
  const vd = new VideoDecoder({ output: frame => { try { onVideoFrame(frame); } catch (error) { failure = error; } finally { frame.close(); } }, error: error => failure = error });
  const ad = new AudioDecoder({ output: frame => {
    try { const values = new Float32Array(frame.numberOfFrames); frame.copyTo(values, { planeIndex: 0, format: 'f32-planar' });
      sound.push({ timestamp: frame.timestamp, rate: frame.sampleRate, values }); }
    catch (error) { failure = error; } finally { frame.close(); }
  }, error: error => failure = error });
  try {
    vd.configure({ codec: 'vp8', codedWidth: video.width, codedHeight: video.height, colorSpace: video.colorSpace });
    // Family 0 mono/stereo packets are raw Opus. Apply container CodecDelay once above.
    if (audio.private && audio.private[18] !== 0) throw new Error('Opus channel mappingに未対応');
    ad.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: audio.channels });
    for (const packet of file.packets) {
      if (packet.track === video.number) vd.decode(new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: packet.timestamp, data: packet.data }));
      if (packet.track === audio.number) ad.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.timestamp, data: packet.data }));
      while (vd.decodeQueueSize > 12 || ad.decodeQueueSize > 20) { await new Promise(resolve => setTimeout(resolve, 0)); if (failure) throw failure; }
    }
    await Promise.all([vd.flush(), ad.flush()]); if (failure) throw failure;
    return { tracks: file.tracks.map(({ private: ignored, ...t }) => t), sound };
  } finally { vd.close(); ad.close(); }
}

export function soundOnsets(sound, { threshold = .07, gapSeconds = .4 } = {}) {
  const result = []; let last = -Infinity;
  for (const frame of sound) {
    const window = Math.max(1, Math.round(frame.rate / 1000));
    for (let i = 0; i < frame.values.length; i += window) {
      const part = frame.values.subarray(i, i + window), rms = Math.sqrt(part.reduce((sum, x) => sum + x * x, 0) / part.length);
      const seconds = frame.timestamp / 1e6 + i / frame.rate;
      if (rms > threshold && seconds - last > gapSeconds) { result.push(seconds); last = seconds; }
    }
  }
  return result;
}

export function imageMetrics(expected, decoded, background, width, height) {
  let square = 0, absolute = 0, maskSquare = 0, maskCount = 0, foregroundSeen = 0, edge = 0, edgeCount = 0;
  const border = Math.max(1, Math.floor(Math.min(width, height) * .02));
  for (let i = 0; i < expected.length; i += 4) {
    const foreground = Math.max(Math.abs(expected[i] - background[i]), Math.abs(expected[i + 1] - background[i + 1]), Math.abs(expected[i + 2] - background[i + 2])) > 12;
    if (foreground) { maskCount++; if (Math.max(Math.abs(decoded[i] - background[i]), Math.abs(decoded[i + 1] - background[i + 1]), Math.abs(decoded[i + 2] - background[i + 2])) > 8) foregroundSeen++; }
    const x = i / 4 % width, y = Math.floor(i / 4 / width), isEdge = x < border || y < border || x >= width - border || y >= height - border;
    for (let k = 0; k < 3; k++) {
      const difference = expected[i + k] - decoded[i + k]; square += difference * difference; absolute += Math.abs(difference);
      if (foreground) maskSquare += difference * difference;
      if (isEdge) { edge += Math.abs(difference); edgeCount++; }
    }
  }
  const mse = square / (width * height * 3), maskMse = maskCount ? maskSquare / (maskCount * 3) : 0;
  return { psnr: mse ? 10 * Math.log10(255 * 255 / mse) : 100, mae: absolute / (width * height * 3),
    foregroundPixels: maskCount, foregroundPsnr: maskMse ? 10 * Math.log10(255 * 255 / maskMse) : 100,
    foregroundRecall: maskCount ? foregroundSeen / maskCount : 1, edgeMae: edge / edgeCount };
}
