type CobaltLocalProcessingRequest = {
  files: File[];
  args: string[];
  output: {
    format: string;
    type: string;
  };
};

type LibAVLike = {
  onwrite?: (name: string, position: number, data: Uint8Array) => void;
  mkreadaheadfile: (name: string, file: File) => Promise<void>;
  mkwriterdev: (name: string) => Promise<void>;
  ffmpeg: (args: string[]) => Promise<void>;
  unlink: (name: string) => Promise<void>;
  unlinkreadaheadfile: (name: string) => Promise<void>;
};

type OutputSink = {
  write: (position: number, data: Uint8Array) => void;
  toBlob: (type: string) => Blob;
};

export function createProgressSink(
  postProgress: (progress: number | undefined) => void,
): (data: Uint8Array) => void;

export function createOutputSink(): OutputSink;

export function encodeWithLibAV(
  libav: LibAVLike,
  request: CobaltLocalProcessingRequest,
  postProgress: (progress: number | undefined) => void,
): Promise<Blob>;
