export const validMp3Bytes = () => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return bytes;
};

export const validFreeFormatMp3Bytes = () => {
  const frameLength = 300;
  const bytes = new Uint8Array(frameLength * 3);
  for (let offset = 0; offset < bytes.length; offset += frameLength) {
    bytes.set([0xff, 0xfb, 0x00, 0x00], offset);
  }
  return bytes;
};
