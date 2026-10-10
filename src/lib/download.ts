export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob.slice(0, blob.size, "application/octet-stream"));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
