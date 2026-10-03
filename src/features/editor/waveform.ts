import type { TrackClip } from "@/features/library/types";

/** Peaks kept per decoded track; bars are resampled from these to fit the rendered width. */
export const WAVEFORM_PEAK_COUNT = 1024;
export const MAX_WAVEFORM_DECODE_BYTES = 256 * 1024 * 1024;
export const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;
/** Minimum clip length, in seconds, so the two handles can never cross. */
export const MIN_CLIP_SECONDS = 1;

// Decoding at a low sample rate keeps long mixes inside the memory budget; the peak
// envelope only needs to be accurate to a few milliseconds.
const WAVEFORM_SAMPLE_RATE = 8_000;
const CONSERVATIVE_CHANNEL_COUNT = 2;
const PCM_BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export interface WaveformData {
  duration: number;
  peaks: number[];
}

type DecodedAudio = Pick<
  AudioBuffer,
  "duration" | "getChannelData" | "length" | "numberOfChannels"
>;

const waveformCache = new WeakMap<File, Promise<WaveformData>>();
const loadedWaveforms = new WeakMap<File, WaveformData>();
let decodeQueue: Promise<unknown> = Promise.resolve();

export const normalizeSeconds = (value: number | null | undefined) =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;

export const formatTimestamp = (seconds: number) => {
  const total = Math.floor(normalizeSeconds(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`
    : `${minutes}:${remainingSeconds}`;
};

export const getPointerTime = (clientX: number, left: number, width: number, duration: number) => {
  const safeDuration = normalizeSeconds(duration);
  if (width <= 0 || safeDuration === 0) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width)) * safeDuration;
};

export const fullClip = (duration: number): TrackClip => ({
  start: 0,
  end: normalizeSeconds(duration),
});

/** Clamps a clip into the track and returns undefined when it covers the whole track. */
export const normalizeClip = (
  clip: TrackClip | undefined,
  duration: number,
): TrackClip | undefined => {
  const safeDuration = normalizeSeconds(duration);
  if (!clip || safeDuration === 0) return undefined;
  const start = Math.min(Math.max(0, clip.start), Math.max(0, safeDuration - MIN_CLIP_SECONDS));
  const end = Math.max(Math.min(safeDuration, clip.end), start + MIN_CLIP_SECONDS);
  const coversTrack = start < 0.05 && end > safeDuration - 0.05;
  return coversTrack ? undefined : { start, end: Math.min(end, safeDuration) };
};

export const moveClipEdge = (
  clip: TrackClip,
  edge: "start" | "end",
  time: number,
  duration: number,
): TrackClip => {
  const safeDuration = normalizeSeconds(duration);
  if (edge === "start") {
    return { ...clip, start: Math.min(Math.max(0, time), clip.end - MIN_CLIP_SECONDS) };
  }
  return { ...clip, end: Math.max(Math.min(safeDuration, time), clip.start + MIN_CLIP_SECONDS) };
};

export const extractPeaks = (audio: DecodedAudio, peakCount = WAVEFORM_PEAK_COUNT) => {
  const count = Math.max(1, peakCount);
  const peaks = Array.from({ length: count }, () => 0);
  if (audio.length === 0 || audio.numberOfChannels === 0) return peaks;

  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  const framesPerPeak = audio.length / count;
  for (let peakIndex = 0; peakIndex < count; peakIndex += 1) {
    const start = Math.floor(peakIndex * framesPerPeak);
    const end = Math.max(start + 1, Math.floor((peakIndex + 1) * framesPerPeak));
    let peak = 0;
    for (const channel of channels) {
      for (let frame = start; frame < Math.min(end, channel.length); frame += 1) {
        const value = Math.abs(channel[frame] ?? 0);
        if (value > peak) peak = value;
      }
    }
    peaks[peakIndex] = peak;
  }

  const loudest = Math.max(...peaks);
  return loudest === 0 ? peaks : peaks.map((peak) => peak / loudest);
};

/** Resamples stored peaks to the number of bars that fit the rendered width. */
export const resamplePeaks = (peaks: number[], barCount: number) => {
  const count = Math.max(1, Math.floor(barCount));
  if (peaks.length === 0) return Array.from({ length: count }, () => 0);
  const peaksPerBar = peaks.length / count;
  return Array.from({ length: count }, (_, barIndex) => {
    const start = Math.floor(barIndex * peaksPerBar);
    const end = Math.max(start + 1, Math.floor((barIndex + 1) * peaksPerBar));
    let peak = 0;
    for (let index = start; index < Math.min(end, peaks.length); index += 1) {
      peak = Math.max(peak, peaks[index] ?? 0);
    }
    return peak;
  });
};

const decodeWaveform = async (file: File, durationHint: number): Promise<WaveformData> => {
  if (file.size > MAX_WAVEFORM_DECODE_BYTES) throw new Error("audio is too large to decode");
  const estimatedBytes =
    normalizeSeconds(durationHint) *
    WAVEFORM_SAMPLE_RATE *
    CONSERVATIVE_CHANNEL_COUNT *
    PCM_BYTES_PER_SAMPLE;
  if (estimatedBytes > MAX_DECODED_PCM_BYTES) throw new Error("audio is too long to decode");
  if (typeof OfflineAudioContext === "undefined") throw new Error("audio decoding is unavailable");

  const bytes = await file.arrayBuffer();
  // decodeAudioData resamples to the context rate, so a low-rate offline context keeps
  // the decoded buffer small.
  const context = new OfflineAudioContext(1, 1, WAVEFORM_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(bytes);
  if (decoded.length * decoded.numberOfChannels * PCM_BYTES_PER_SAMPLE > MAX_DECODED_PCM_BYTES) {
    throw new Error("decoded audio is too large");
  }
  return { duration: normalizeSeconds(decoded.duration), peaks: extractPeaks(decoded) };
};

/** decodes one file at a time and releases cached peaks when its source file is collected */
export const loadWaveform = (file: File, durationHint: number) => {
  const cached = waveformCache.get(file);
  if (cached) return cached;
  const pending = decodeQueue.then(() => decodeWaveform(file, durationHint));
  decodeQueue = pending.catch(() => undefined);
  waveformCache.set(file, pending);
  pending.then(
    (data) => loadedWaveforms.set(file, data),
    () => waveformCache.delete(file),
  );
  return pending;
};

export const getLoadedWaveform = (file: File | undefined) =>
  file ? loadedWaveforms.get(file) : undefined;
