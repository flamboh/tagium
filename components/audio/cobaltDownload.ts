import { downloadFromCobalt, runAudioBackendEffect } from "./audioBackend";
import type { CobaltAudioDownloadRequest } from "./cobaltAudio";

export async function downloadCobaltAudio(request: CobaltAudioDownloadRequest) {
  return await runAudioBackendEffect(downloadFromCobalt(request));
}

export {
  CobaltAudio,
  CobaltAudioLive,
  type AudioDownloadBitrate,
  type CobaltAudioDownloadLifecycleCallback,
  type CobaltAudioDownloadLifecycleEvent,
  type CobaltAudioDownloadRequest,
  type CobaltDownloadPlan,
} from "./cobaltAudio";
export {
  LocalAudioProcessor,
  LocalAudioProcessorLive,
  applyCobaltAudioMetadata,
  validateLocalAudioPlan,
} from "./localAudioProcessor";
