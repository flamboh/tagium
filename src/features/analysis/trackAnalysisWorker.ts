import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import { analyzeSamples, type TrackAnalysis } from "@/features/analysis/trackAnalysis";

/** Mono samples at the analysis rate. */
export type TrackAnalysisRequest = { samples: Float32Array<ArrayBuffer> };

export type TrackAnalysisMessage = { analysis: TrackAnalysis } | { error: string };

const essentia = new Essentia(EssentiaWASM);

self.onmessage = (event: MessageEvent<TrackAnalysisRequest>) => {
  let message: TrackAnalysisMessage;

  try {
    message = { analysis: analyzeSamples(essentia, event.data.samples) };
  } catch (error) {
    message = { error: error instanceof Error ? error.message : "track analysis failed." };
  }

  self.postMessage(message);
};
