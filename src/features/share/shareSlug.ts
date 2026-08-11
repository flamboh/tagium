export const SHARE_SLUG_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const SHARE_SLUG_LENGTH = 6;
export const SHARE_SLUG_PATTERN = /^[23456789abcdefghjkmnpqrstvwxyz]{6}$/;

const RANDOM_BYTE_LIMIT = Math.floor(256 / SHARE_SLUG_ALPHABET.length) * SHARE_SLUG_ALPHABET.length;

export const createShareSlug = () => {
  const bytes = new Uint8Array(SHARE_SLUG_LENGTH);
  let slug = "";

  while (slug.length < SHARE_SLUG_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= RANDOM_BYTE_LIMIT) continue;
      slug += SHARE_SLUG_ALPHABET[byte % SHARE_SLUG_ALPHABET.length];
      if (slug.length === SHARE_SLUG_LENGTH) return slug;
    }
  }

  return slug;
};
