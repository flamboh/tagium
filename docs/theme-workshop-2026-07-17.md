# Theme workshop v2 — liner becomes the design

Decision from review of v1 (docs/theme-refresh-2026-07-16.md): **liner wins.** The squared-off,
flat, hairline look is the app's design going forward, in a light and a dark mode. The
`signal` and `pressing` themes are removed — but pressing's best ideas move into liner:
a color-drenched sidebar and a two-ink accent system, now user-configurable.

## Settings model (replaces `theme`)

```ts
mode: "light" | "dark"; // default "light"
accentA: string; // hex, default cobalt (see presets)
accentB: string; // hex, default coral
wordmarkFont: "archivo-black" | "krona-one" | "anton" | "rajdhani"; // default "archivo-black"
```

Old stored `theme` values: `signal` → `mode: "dark"`, anything else → `"light"` (accents/font
default). Schema keeps the existing catchDecoding/withDecodingDefaultKey fallback pattern.

`<html>` carries `data-theme="light" | "dark"` (plus `.dark` class in dark mode) and inline
style custom properties `--accent-a` / `--accent-b`. The pre-paint script in index.html sets
all of these from localStorage before first paint. Foreground pairs are computed in JS (see
below) in the theme-applying effect; a one-frame default before mount is acceptable.

## Accent roles

- **Accent A — workhorse ink**: primary buttons, focus ring, selection, links, and the
  sidebar surface.
- **Accent B — punch ink**: wordmark dot, the sidebar's primary action (download all),
  selected-track markers. Never body-size text.

### Computed foregrounds (JS util, ~20 lines)

For each accent, pick white `oklch(0.985 0 0)` or ink `oklch(0.22 0.015 264)` as foreground,
whichever has higher WCAG contrast against the accent. Resolve arbitrary CSS colors to sRGB
with a 1×1 canvas (fillStyle → getImageData), then relative luminance → contrast ratio.
Set `--accent-a-fg` and `--accent-b-fg` on `document.documentElement.style` alongside the
accents. Unit-test the util (white for cobalt, ink for a light yellow).

## Token derivation (CSS does the rest via color-mix)

Base **light** block (`:root, [data-theme="light"]`) keeps liner v1's values for: radius
(0.125rem), hero radii, background/foreground/card/popover/muted/border/input/destructive,
font-sans (Libre Franklin), font-mono (Fragment Mono), flat shadows, --success. Then:

```css
--primary: var(--accent-a);
--primary-foreground: var(--accent-a-fg, oklch(0.985 0 0));
--ring: var(--accent-a);
--accent: color-mix(in oklab, var(--accent-a) 10%, var(--background));
--accent-foreground: var(--foreground);
--secondary: color-mix(in oklab, var(--accent-a) 14%, var(--background));
--secondary-foreground: var(--foreground);
--sidebar: var(--accent-a); /* the drench */
--sidebar-foreground: var(--accent-a-fg, oklch(0.985 0 0));
--sidebar-border: color-mix(in oklab, var(--sidebar-foreground) 22%, var(--sidebar));
--sidebar-accent: color-mix(in oklab, var(--sidebar-foreground) 14%, var(--sidebar));
--sidebar-accent-foreground: var(--sidebar-foreground);
--sidebar-primary: var(--accent-b);
--sidebar-primary-foreground: var(--accent-b-fg, oklch(0.22 0.015 264));
--sidebar-ring: var(--accent-b);
--wordmark-dot: var(--accent-b);
```

Inside the sidebar subtree, keep/adapt the v1 pressing-style remap on
`[data-slot="sidebar-panel"]`, now for both modes: remap `--primary` →
`var(--sidebar-primary)` (+fg), `--muted-foreground` →
`color-mix(in oklab, var(--sidebar-foreground) 78%, var(--sidebar))`, `--border`/`--input` →
sidebar-border, `--accent` → sidebar-accent, `--background` → sidebar, `--foreground` →
sidebar-foreground, `--success`/`--destructive` → mix 35% toward sidebar-foreground for
legibility on saturated surfaces.

**Dark** block (`[data-theme="dark"]`, liner-ized dark — same shapes, flat, hairlines):

```css
--background: oklch(0.17 0.008 264);
--foreground: oklch(0.93 0.005 264);
--card / --popover: oklch(0.205 0.01 264);
--muted: oklch(0.25 0.01 264);
--muted-foreground: oklch(0.72 0.015 264);
--border: oklch(0.29 0.01 264);
--input: oklch(0.25 0.01 264);
--destructive: oklch(0.62 0.19 25);
--success: oklch(0.72 0.15 150);
--sidebar: color-mix(in oklab, var(--accent-a) 30%, oklch(0.13 0.008 264));
--sidebar-foreground: oklch(0.93 0.005 264);   /* fixed: dark sidebar is always deep */
/* accent-a/b used as-is for primary / sidebar-primary / dot, same derivations as light */
/* shadows stay flat-transparent like liner; hover washes: color-mix 14% accent into bg */
```

## Accent presets (swatches shown above the pickers; clicking sets both accents)

Store as hex (convert these OKLCH definitions exactly — use the OKLab math or culori — and
keep the oklch source values in a comment):

| name                     | accent A             | accent B             |
| ------------------------ | -------------------- | -------------------- |
| cobalt & coral (default) | oklch(0.46 0.19 262) | oklch(0.62 0.21 30)  |
| forest & marigold        | oklch(0.45 0.12 155) | oklch(0.68 0.16 75)  |
| oxblood & teal           | oklch(0.42 0.16 25)  | oklch(0.60 0.11 200) |
| aubergine & chartreuse   | oklch(0.42 0.14 310) | oklch(0.72 0.17 125) |
| ink & vermilion          | oklch(0.32 0.05 264) | oklch(0.60 0.21 33)  |

Settings UI ("appearance" section, lowercase voice):

1. **mode** — light / dark (radio pair, like the current theme cards but two options).
2. **accents** — the five preset swatch cards (two ink chips + name each; selected state when
   both stored accents match the preset), then two native `<input type="color">` pickers
   labeled "accent a" / "accent b" for free play.
3. **wordmark** — four choices, each label rendered as "tagium." IN its own font.

## Wordmark fonts

Add fontsource packages (all single-weight or one weight): `@fontsource/archivo-black`,
`@fontsource/krona-one`, `@fontsource/anton`, `@fontsource/rajdhani` (700 only).
Remove `@fontsource/barlow`, `@fontsource/ibm-plex-mono`, `@fontsource/space-mono`,
`@fontsource-variable/archivo` (signal/pressing casualties). Keep Libre Franklin (UI) and
Fragment Mono (numerals).

`--font-wordmark` + `--wordmark-tracking` + `--wordmark-scale` set on `<html>` by the theme
effect per selection; both wordmark elements (`.wordmark` in sidebar + landing h1) use
`font-family: var(--font-wordmark)` with `font-size: calc(1em * var(--wordmark-scale))`
so optical sizes match across fonts:

- `archivo-black` — scale 1.0, tracking -0.02em (heavy poster grotesque; default)
- `krona-one` — scale 0.82, tracking -0.01em (wide squared geometric — check truncation)
- `anton` — scale 1.06, tracking 0.01em (condensed record-sleeve poster)
- `rajdhani` (700) — scale 1.12, tracking 0 (squared terminals, most literally "squared-off")

Landing h1 keeps its current pixel budget; verify none of the four overflow the sidebar
header or wrap on mobile (390px).

## Cleanup

- Delete `src/themes/signal.css` and `src/themes/pressing.css`; new files `light.css` /
  `dark.css` (or one `liner.css` with both blocks). Update imports, pre-paint script,
  settings schema/UI, and any tests referencing the old theme names.
- Default boot: light mode, cobalt & coral, archivo-black.

## Verification

typecheck, lint, unit tests green; screenshots: light+dark at desktop and 390px mobile
(landing, editor with tracks, settings), plus one alternate preset (oxblood & teal) light
editor. Confirm no wordmark overflow in any font at both sizes, and that the JS foreground
util picks ink on light accents / white on dark accents.
