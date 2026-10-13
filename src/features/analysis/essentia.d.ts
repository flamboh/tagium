declare module "essentia.js/dist/essentia-wasm.es.js" {
  /** The compiled essentia module; opaque to callers and only handed to the Essentia class. */
  export interface EssentiaWasmModule {
    readonly calledRun?: boolean;
  }

  export const EssentiaWASM: EssentiaWasmModule;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  import type { EssentiaWasmModule } from "essentia.js/dist/essentia-wasm.es.js";

  interface EssentiaVector {
    delete(): void;
  }

  export default class Essentia {
    constructor(wasmModule: EssentiaWasmModule);
    arrayToVector(samples: Float32Array): EssentiaVector;
    PercivalBpmEstimator(
      signal: EssentiaVector,
      frameSize?: number,
      frameSizeOSS?: number,
      hopSize?: number,
      hopSizeOSS?: number,
      maxBPM?: number,
      minBPM?: number,
      sampleRate?: number,
    ): { bpm: number };
    KeyExtractor(
      audio: EssentiaVector,
      averageDetuningCorrection?: boolean,
      frameSize?: number,
      hopSize?: number,
      hpcpSize?: number,
      maxFrequency?: number,
      maximumSpectralPeaks?: number,
      minFrequency?: number,
      pcpThreshold?: number,
      profileType?: string,
      sampleRate?: number,
    ): { key: string; scale: string; strength: number };
  }
}
