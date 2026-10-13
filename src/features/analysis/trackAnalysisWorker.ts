import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import { analyzeSamples, mixToMono, type TrackAnalysis } from "@/features/analysis/trackAnalysis";

export type TrackAnalysisRequest = { channels: Float32Array[] };

export type TrackAnalysisMessage = { analysis: TrackAnalysis } | { error: string };

const essentia = new Essentia(EssentiaWASM);

self.onmessage = (event: MessageEvent<TrackAnalysisRequest>) => {
  let message: TrackAnalysisMessage;

  try {
    message = { analysis: analyzeSamples(essentia, mixToMono(event.data.channels)) };
  } catch (error) {
    message = { error: error instanceof Error ? error.message : "track analysis failed." };
  }

  self.postMessage(message);
};
