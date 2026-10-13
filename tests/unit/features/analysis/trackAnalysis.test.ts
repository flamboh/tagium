import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import { describe, expect, it } from "vite-plus/test";
import { formatMusicalKey } from "@/features/analysis/musicalKey";
import {
  ANALYSIS_SAMPLE_RATE,
  analyzeSamples,
  foldBpm,
  mixToMono,
} from "@/features/analysis/trackAnalysis";

const essentia = new Essentia(EssentiaWASM);

const frequency = (midiNote: number) => 440 * 2 ** ((midiNote - 69) / 12);

/** A kick on every beat under a sustained chord: enough rhythm and harmony to analyze. */
const synthesize = (bpm: number, midiNotes: number[], seconds = 40) => {
  const samples = new Float32Array(ANALYSIS_SAMPLE_RATE * seconds);
  const beat = 60 / bpm;

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / ANALYSIS_SAMPLE_RATE;
    let value = 0;

    for (const note of midiNotes) {
      const phase = 2 * Math.PI * frequency(note) * time;
      value += 0.08 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
    }

    const sinceBeat = time % beat;
    value +=
      0.8 *
      Math.exp(-sinceBeat * 30) *
      Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-sinceBeat * 40)) * sinceBeat);
    samples[index] = value;
  }

  return samples;
};

describe("track analysis", () => {
  it.each([
    { name: "a minor house", bpm: 128, notes: [57, 60, 64, 69, 72, 76], key: "Am", expected: 128 },
    { name: "c major pop", bpm: 100, notes: [48, 52, 55, 60, 64, 67], key: "C", expected: 100 },
    {
      name: "f sharp minor drum and bass",
      bpm: 174,
      notes: [54, 57, 61, 66, 69, 73],
      key: "F#m",
      expected: 174,
    },
    {
      name: "e flat major half time",
      bpm: 70,
      notes: [51, 55, 58, 63, 67, 70],
      key: "Eb",
      expected: 140,
    },
  ])("detects the tempo and key of $name", ({ bpm, notes, key, expected }) => {
    const analysis = analyzeSamples(essentia, synthesize(bpm, notes));
    expect(analysis.bpm).not.toBeNull();
    expect(Math.abs(analysis.bpm! - expected)).toBeLessThanOrEqual(1);
    expect(analysis.key && formatMusicalKey(analysis.key, "standard")).toBe(key);
  });

  it("leaves silence and very short audio undetected", () => {
    expect(analyzeSamples(essentia, new Float32Array(ANALYSIS_SAMPLE_RATE * 30))).toEqual({
      bpm: null,
      key: null,
    });
    expect(analyzeSamples(essentia, synthesize(128, [57, 60, 64], 5))).toEqual({
      bpm: null,
      key: null,
    });
  });

  it("folds tempo estimates into one octave", () => {
    expect(foldBpm(128.4)).toBe(128);
    expect(foldBpm(86.86)).toBe(174);
    expect(foldBpm(70.07)).toBe(140);
    expect(foldBpm(200)).toBe(100);
    expect(foldBpm(176)).toBe(88);
    expect(foldBpm(0)).toBeNull();
    expect(foldBpm(Number.NaN)).toBeNull();
  });

  it("averages channels into mono", () => {
    const left = Float32Array.of(1, 0, -1);
    expect(mixToMono([left])).toBe(left);
    expect(Array.from(mixToMono([left, Float32Array.of(0, 0, 1)]))).toEqual([0.5, 0, 0]);
    expect(mixToMono([])).toHaveLength(0);
  });
});
