import type Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { parseMusicalKey, type MusicalKey } from "@/features/analysis/musicalKey";

export interface TrackAnalysis {
  bpm: number | null;
  key: MusicalKey | null;
}

/** Tracks longer than this are mixes; one tempo and key would not describe them. */
export const MAX_ANALYSIS_SECONDS = 15 * 60;

// Half the usual rate keeps a full-length decode small and still covers the 3.5 khz the key
// profile listens to.
export const ANALYSIS_SAMPLE_RATE = 22_050;

const MIN_ANALYSIS_SECONDS = 10;

const SILENCE_PEAK = 1e-3;

// Tempo estimators cannot tell a beat from its half or double, so every estimate is folded into
// one octave. This one keeps house, techno and drum and bass at the tempo djs count them in.
const MIN_BPM = 88;

const MAX_BPM = 176;

// The estimator's frame sizes are tuned for 44.1 khz.
const frameScale = ANALYSIS_SAMPLE_RATE / 44_100;

export const foldBpm = (bpm: number) => {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  let folded = bpm;

  while (folded < MIN_BPM) folded *= 2;

  while (folded >= MAX_BPM) folded /= 2;

  return Math.round(folded);
};

export const mixToMono = (channels: readonly Float32Array[]) => {
  const [first, ...rest] = channels;

  if (!first) return new Float32Array();

  if (rest.length === 0) return first;
  const mono = new Float32Array(first.length);

  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) mono[index]! += channel[index] ?? 0;
  }

  for (let index = 0; index < mono.length; index += 1) mono[index]! /= channels.length;

  return mono;
};

const isSilent = (samples: Float32Array) => {
  for (const sample of samples) {
    if (Math.abs(sample) > SILENCE_PEAK) return false;
  }

  return true;
};

/** Estimates tempo and key from mono samples at ANALYSIS_SAMPLE_RATE. */
export const analyzeSamples = (essentia: Essentia, samples: Float32Array): TrackAnalysis => {
  if (samples.length < MIN_ANALYSIS_SECONDS * ANALYSIS_SAMPLE_RATE || isSilent(samples)) {
    return { bpm: null, key: null };
  }

  const signal = essentia.arrayToVector(samples);

  try {
    // essentia reports failures by throwing raw wasm exception pointers, so each estimate is
    // isolated and a failed one is simply left undetected.
    let bpm: number | null = null;

    try {
      bpm = foldBpm(
        essentia.PercivalBpmEstimator(
          signal,
          Math.round(1024 * frameScale),
          Math.round(2048 * frameScale),
          Math.round(128 * frameScale),
          Math.round(128 * frameScale),
          210,
          50,
          ANALYSIS_SAMPLE_RATE,
        ).bpm,
      );
    } catch {
      bpm = null;
    }

    let key: MusicalKey | null = null;

    try {
      const detected = essentia.KeyExtractor(
        signal,
        true,
        4096,
        4096,
        12,
        3500,
        60,
        25,
        0.2,
        // the profile essentia derived from electronic dance music.
        "edma",
        ANALYSIS_SAMPLE_RATE,
      );

      key = parseMusicalKey(`${detected.key}${detected.scale === "minor" ? "m" : ""}`) ?? null;
    } catch {
      key = null;
    }

    return { bpm, key };
  } finally {
    signal.delete();
  }
};
