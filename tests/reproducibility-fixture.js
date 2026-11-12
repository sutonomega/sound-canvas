// Shared deterministic PCM for analysis-to-render reproducibility checks. No personal audio.
export function reproducibilityFixture(sampleRate = 8000, length = 80904) {
  const data = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length }, (_, i) => {
    const time = i / sampleRate;
    if (time < .4) return 0;
    const beat = time % .47, level = time < 4.5 ? .35 : .85;
    return level * (.22 * Math.sin(2 * Math.PI * 70 * time) * Math.exp(-beat * 16)
      + .12 * Math.sin(2 * Math.PI * (channel ? 330 : 220) * time)
      + .055 * Math.sin(2 * Math.PI * (channel ? 2900 : 3100) * time) * Math.exp(-(time % .23) * 12));
  }));
  return { sampleRate, length, numberOfChannels: 2, duration: length / sampleRate, getChannelData: channel => data[channel] };
}
