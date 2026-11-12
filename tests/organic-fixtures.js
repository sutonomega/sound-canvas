// One shared normalization context: silence → calm → bass beat + bright detail.
// Entirely synthesized; no third-party music or user files.
export function organicFixture(sampleRate = 22050, sectionSeconds = 18) {
  const length = Math.round(sampleRate * sectionSeconds * 3), samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    if (time < sectionSeconds) continue;
    if (time < sectionSeconds * 2) {
      const t = time - sectionSeconds;
      const fade = Math.min(1, t / 2, (sectionSeconds - t) / 2);
      samples[i] = fade * (.8 + .2 * Math.sin(t * .5))
        * (.035 * Math.sin(2 * Math.PI * 220 * t) + .02 * Math.sin(2 * Math.PI * 330 * t));
    } else {
      const t = time - sectionSeconds * 2;
      const fade = Math.min(1, t / .3, (sectionSeconds - t) / .8);
      samples[i] = fade * (.6 + .4 * t / sectionSeconds) * (
        .32 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-(t % .5) * 18)
        + .11 * Math.sin(2 * Math.PI * 440 * t) * (.4 + .6 * Math.exp(-(t % 1) * 4))
        + .1 * Math.sin(2 * Math.PI * 6000 * t) * (.25 + .75 * Math.exp(-(t % .25) * 30)));
    }
  }
  return { sampleRate, length, numberOfChannels: 1, duration: length / sampleRate,
    getChannelData: () => samples };
}

export const organicScenarios = Object.freeze([
  { id: 'silence', label: '無音' }, { id: 'calm', label: '穏やかな曲' }, { id: 'beat', label: '強いビート' },
]);

export function organicStress(frame) {
  return { volume: .75 + .2 * Math.sin(frame * .005), bass: .7 + .25 * Math.sin(frame * .007),
    mid: .55 + .4 * Math.sin(frame * .003), high: .65 + .3 * Math.sin(frame * .011),
    intensity: .8 + .15 * Math.sin(frame * .002), beat: frame % 15 === 0 };
}
