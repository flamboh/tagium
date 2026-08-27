/** Tagium Save's browser download interface. */
export {
  cobaltAudioBitrates,
  cobaltAudioFormats,
  cobaltDownloadModes,
  cobaltFilenameStyles,
  cobaltVideoCodecs,
  cobaltVideoContainers,
  cobaltVideoQualities,
  decodeCobaltDownloadPlanEffect,
  decodeCobaltDownloadResponseEffect,
  makeCobaltVideoDownloadRequestBody,
  type CobaltAudioBitrate,
  type CobaltAudioFormat,
  type CobaltDownloadMode,
  type CobaltDownloadPlan,
  type CobaltDownloadResponse,
  type CobaltFilenameStyle,
  type CobaltLocalProcessingPlan,
  type CobaltPickerItem,
  type CobaltPickerPlan,
  type CobaltRedirectPlan,
  type CobaltTunnelPlan,
  type CobaltVideoCodec,
  type CobaltVideoContainer,
  type CobaltVideoDownloadRequest,
  type CobaltVideoDownloadRequestBody,
  type CobaltVideoQuality,
} from "./cobaltDownloadSchemas";
export type {
  CobaltDownloadPlan as VideoDownloadPlan,
  CobaltVideoDownloadRequest as VideoDownloadRequest,
} from "./cobaltDownloadSchemas";
export {
  makeLocalProcessingFfmpegArgs,
  makeMetadataFfmpegArgs,
  outputFormatFromFilename,
  VIDEO_PROGRESS_FILENAME,
} from "./ffmpegArgs";
export {
  downloadVideoFile,
  downloadVideoPickerItem,
  executeVideoDownload,
  resolveVideoDownload,
  startVideoDownload,
  VideoDownloadError,
  type VideoDownloadCallbacks,
  type VideoDownloadPhase,
  type VideoDownloadProgress,
  type VideoDownloadResult,
  type VideoDownloadStage,
  type VideoDownloadTask,
  type VideoFileDownloadResult,
  type VideoPickerDownloadResult,
} from "./videoDownload";
export type { VideoDownloadSelection } from "./videoDownload";
export {
  createTemporaryFileStore,
  type TemporaryFileStore,
  type TemporaryFileStoreBackend,
} from "./storage";
