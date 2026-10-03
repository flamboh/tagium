const FONT_WAIT_LIMIT_MS = 800;

export function holdForFonts() {
  const root = document.documentElement;
  const reveal = () => root.classList.remove("fonts-loading");
  root.classList.add("fonts-loading");
  void document.fonts.load('500 1em "Satoshi"').finally(reveal);
  setTimeout(reveal, FONT_WAIT_LIMIT_MS);
}
