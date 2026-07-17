export const MAX_WAVEFORM_SAMPLES = 320;
export const MAX_WAVEFORM_DECODE_BYTES = 96 * 1024 * 1024;
export const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;

const CONSERVATIVE_SAMPLE_RATE = 48_000;
const CONSERVATIVE_CHANNEL_COUNT = 2;
const PCM_BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export interface WaveformPreviewData {
  duration: number;
  samples: number[];
}

type DecodedAudio = Pick<
  AudioBuffer,
  "duration" | "getChannelData" | "length" | "numberOfChannels"
>;

const waveformCache = new WeakMap<File, WaveformPreviewData>();
let decodeQueue: Promise<void> = Promise.resolve();

const canceled = () => new DOMException("waveform load canceled", "AbortError");

const throwIfCanceled = (signal: AbortSignal) => {
  if (signal.aborted) throw canceled();
};

export const normalizePreviewDuration = (duration: number | null | undefined) =>
  Number.isFinite(duration) && Number(duration) > 0 ? Number(duration) : 0;

export const estimateDecodedPcmBytes = (
  duration: number,
  sampleRate = CONSERVATIVE_SAMPLE_RATE,
  channelCount = CONSERVATIVE_CHANNEL_COUNT,
) => normalizePreviewDuration(duration) * sampleRate * channelCount * PCM_BYTES_PER_SAMPLE;

const enqueueDecode = <Result>(signal: AbortSignal, task: () => Promise<Result>) => {
  const result = decodeQueue.then(async () => {
    throwIfCanceled(signal);
    return task();
  });
  decodeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const formatPreviewTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

export const getSeekTime = (clientX: number, left: number, width: number, duration: number) => {
  const safeDuration = normalizePreviewDuration(duration);
  if (width <= 0 || safeDuration === 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return ratio * safeDuration;
};

export const downsampleWaveform = (audio: DecodedAudio, sampleCount = MAX_WAVEFORM_SAMPLES) => {
  const boundedSampleCount = Math.max(1, Math.min(MAX_WAVEFORM_SAMPLES, sampleCount));
  if (audio.length === 0 || audio.numberOfChannels === 0) {
    return Array.from({ length: boundedSampleCount }, () => 0);
  }

  const samples = Array.from({ length: boundedSampleCount }, () => 0);
  const framesPerSample = audio.length / boundedSampleCount;

  for (let sampleIndex = 0; sampleIndex < boundedSampleCount; sampleIndex += 1) {
    const start = Math.floor(sampleIndex * framesPerSample);
    const end = Math.max(start + 1, Math.floor((sampleIndex + 1) * framesPerSample));
    let peak = 0;

    for (let channelIndex = 0; channelIndex < audio.numberOfChannels; channelIndex += 1) {
      const channel = audio.getChannelData(channelIndex);
      for (let frameIndex = start; frameIndex < Math.min(end, channel.length); frameIndex += 1) {
        peak = Math.max(peak, Math.abs(channel[frameIndex] ?? 0));
      }
    }
    samples[sampleIndex] = peak;
  }

  const loudestSample = Math.max(...samples, 0);
  if (loudestSample === 0) return samples;
  return samples.map((sample) => sample / loudestSample);
};

const decodeWaveform = async (
  file: File,
  signal: AbortSignal,
  durationHint: number,
): Promise<WaveformPreviewData> => {
  if (file.size > MAX_WAVEFORM_DECODE_BYTES) throw new Error("audio is too large to decode safely");
  const safeDurationHint = normalizePreviewDuration(durationHint);
  if (safeDurationHint === 0) throw new Error("audio duration is required for safe decoding");
  if (estimateDecodedPcmBytes(safeDurationHint) > MAX_DECODED_PCM_BYTES) {
    throw new Error("audio duration exceeds the waveform memory budget");
  }
  if (typeof AudioContext === "undefined") throw new Error("audio decoding is unavailable");

  const bytes = await file.arrayBuffer();
  throwIfCanceled(signal);
  const context = new AudioContext();
  try {
    // Web Audio cannot cancel decodeAudioData. The serialized queue keeps this bounded
    // context exclusive; cancellation only discards its result after the decode settles.
    const decodedAudio = await context.decodeAudioData(bytes);
    throwIfCanceled(signal);
    const decodedBytes = decodedAudio.length * decodedAudio.numberOfChannels * PCM_BYTES_PER_SAMPLE;
    if (decodedBytes > MAX_DECODED_PCM_BYTES) {
      throw new Error("decoded audio exceeds the waveform memory budget");
    }
    return {
      duration: normalizePreviewDuration(decodedAudio.duration),
      samples: downsampleWaveform(decodedAudio),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
};

export const loadWaveformPreview = async (file: File, signal: AbortSignal, durationHint = 0) => {
  throwIfCanceled(signal);
  const cached = waveformCache.get(file);
  if (cached) return cached;
  if (normalizePreviewDuration(durationHint) === 0) {
    throw new Error("audio duration is required for safe decoding");
  }

  return enqueueDecode(signal, async () => {
    throwIfCanceled(signal);
    const queuedCache = waveformCache.get(file);
    if (queuedCache) return queuedCache;
    const preview = await decodeWaveform(file, signal, durationHint);
    throwIfCanceled(signal);
    waveformCache.set(file, preview);
    return preview;
  });
};
