import type { AudioMetadata, TagiumFile } from "./types";

type WritableExportFile = TagiumFile & {
  file: File;
  metadata: AudioMetadata;
};

type ExportMetadataWriter = (file: WritableExportFile, metadata: AudioMetadata) => Promise<void>;

const EXPORT_METADATA_WRITE_CONCURRENCY = 2;

const isWritableExportFile = (file: TagiumFile): file is WritableExportFile =>
  Boolean(file.file && file.metadata);

export async function writeExportMetadata(
  files: TagiumFile[],
  writeFile: ExportMetadataWriter,
): Promise<void> {
  const writableFiles = files.filter(isWritableExportFile);
  let nextIndex = 0;
  const failures: Array<{ index: number; error: unknown }> = [];

  const writeNext = async (): Promise<void> => {
    if (failures.length > 0) return;

    const index = nextIndex;
    const file = writableFiles[index];
    nextIndex += 1;
    if (!file) return;

    try {
      await writeFile(file, file.metadata);
    } catch (error) {
      failures.push({ index, error });
      return;
    }
    return writeNext();
  };

  await Promise.all(
    Array.from(
      { length: Math.min(EXPORT_METADATA_WRITE_CONCURRENCY, writableFiles.length) },
      writeNext,
    ),
  );

  const failure = failures.reduce<(typeof failures)[number] | undefined>(
    (firstFailure, nextFailure) =>
      !firstFailure || nextFailure.index < firstFailure.index ? nextFailure : firstFailure,
    undefined,
  );
  if (failure) throw failure.error;
}
