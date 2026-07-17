import filenamify from "filenamify";

export const sanitizeFilenameBase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return filenamify(trimmed, { replacement: "-" });
};

export const isValidFilenameBase = (value: string) => sanitizeFilenameBase(value).length > 0;
