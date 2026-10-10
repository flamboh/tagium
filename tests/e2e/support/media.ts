import LibAVWrapper from "@imput/libav.js-encode-cli";
import type { DownloadedFile } from "./audio";

export type ProbedStream = {
  type: string;
  codec: string;
  width?: number;
  height?: number;
  frames: number | null;
  packets: number;
};

export type MediaProbe = {
  container: string;
  duration: number;
  streams: ProbedStream[];
  tags: Record<string, string>;
  /** Top-level iso bmff box types, only read for mp4 files. */
  boxes?: string[];
};

type FfprobeJson = {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    nb_read_frames?: string;
    nb_read_packets?: string;
    tags?: Record<string, string>;
  }[];
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
};

let libav: ReturnType<typeof LibAVWrapper.LibAV> | undefined;

let queue: Promise<unknown> = Promise.resolve();

const lowerKeys = (tags: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]));

const count = (value: string | undefined) =>
  value === undefined || !/^\d+$/u.test(value) ? null : Number(value);

const topLevelBoxes = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: string[] = [];
  let offset = 0;

  while (offset + 8 <= bytes.byteLength) {
    let size = view.getUint32(offset);

    if (size === 1) size = Number(view.getBigUint64(offset + 8));
    else if (size === 0) size = bytes.byteLength - offset;
    boxes.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));

    if (size < 8) break;
    offset += size;
  }

  return boxes;
};

const probe = async (file: DownloadedFile): Promise<MediaProbe> => {
  libav ??= LibAVWrapper.LibAV({ noworker: true, nothreads: true });
  const instance = await libav;
  const input = `probe-input${file.filename.slice(file.filename.lastIndexOf("."))}`;
  const output = "probe-output.json";
  await instance.writeFile(input, file.bytes);

  try {
    const status = await instance.ffprobe(
      "-v",
      "error",
      "-count_frames",
      "-count_packets",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,nb_read_frames,nb_read_packets:stream_tags:format=format_name,duration:format_tags",
      "-of",
      "json",
      "-o",
      output,
      input,
    );

    if (status !== 0) throw new Error(`ffprobe could not read ${file.filename} (${status})`);

    const result = JSON.parse(
      new TextDecoder().decode(await instance.readFile(output)),
    ) as FfprobeJson;

    const streams = (result.streams ?? []).map((stream) => {
      const probed: ProbedStream = {
        type: stream.codec_type ?? "unknown",
        codec: stream.codec_name ?? "unknown",
        frames: count(stream.nb_read_frames),
        packets: count(stream.nb_read_packets) ?? 0,
      };

      if (stream.width !== undefined) {
        probed.width = stream.width;
        probed.height = stream.height;
      }

      return probed;
    });

    const tags = Object.assign(
      {},
      ...(result.streams ?? []).map((stream) => lowerKeys(stream.tags)),
      lowerKeys(result.format?.tags),
    ) as Record<string, string>;

    return {
      container: result.format?.format_name ?? "unknown",
      duration: Number(result.format?.duration ?? Number.NaN),
      streams,
      tags,
      ...(file.filename.endsWith(".mp4") ? { boxes: topLevelBoxes(file.bytes) } : {}),
    };
  } finally {
    await instance.unlink(input).catch(() => {});
    await instance.unlink(output).catch(() => {});
  }
};

export const probeMedia = (file: DownloadedFile): Promise<MediaProbe> => {
  const run = queue.then(() => probe(file));
  queue = run.catch(() => {});

  return run;
};
