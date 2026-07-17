import { chromium } from "@playwright/test";

const theme = process.env.THEME ?? "pressing";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => {
  localStorage.setItem("tagium:app-settings", JSON.stringify({ theme: t }));
}, theme);
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const el = (s) => document.querySelector(s);
  const box = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      pad: cs.padding,
      font: cs.fontFamily.split(",")[0],
      fontStretch: cs.fontStretch,
      bg: cs.backgroundColor,
    };
  };
  const wordmark = el(".wordmark");
  const sidebar = wordmark?.closest("div.flex-col");
  const input = el("input[placeholder*='soundcloud']");
  const icon = input?.parentElement?.querySelector("svg");
  return {
    dataTheme: document.documentElement.dataset.theme,
    darkClass: document.documentElement.classList.contains("dark"),
    htmlFont: getComputedStyle(document.body).fontFamily.split(",")[0],
    wordmark: box(wordmark),
    wordmarkParent: box(wordmark?.parentElement),
    sidebar: box(sidebar),
    urlInput: box(input),
    urlInputPaddingLeft: input ? getComputedStyle(input).paddingLeft : null,
    icon: box(icon),
    viewport: { w: innerWidth, h: innerHeight },
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
