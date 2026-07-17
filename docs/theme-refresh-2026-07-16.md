# Tagium theme refresh — three looks

Goal: replace the default shadcn dark-teal skin with three distinct, switchable visual
themes. UX stays identical; only colors, shapes, typography, and surface treatments change.
All palettes below are contrast-verified (WCAG AA; noted where a color is large-text-only).

The three themes, spread deliberately across the design space:

|                          | **liner** (light)                                                        | **signal** (dark, default)                                          | **pressing** (committed color)                              |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Scene                    | Sunday-afternoon collector cataloguing finds like filling in liner notes | 1 am after a show, lamp off, screen glowing like the amp's VU meter | DIY label kid silk-screening two-ink riso sleeves           |
| Color strategy           | Restrained: ink on cool paper + cobalt accent                            | Committed dark: warm black + amber signal                           | Full palette: ultramarine + fluorescent coral inks on paper |
| Shape                    | Sharp (2px), hairline borders, flat                                      | Soft (12px), layered, subtle glow                                   | Pill buttons, 2px ink lines, flat print                     |
| UI font                  | Libre Franklin                                                           | Barlow                                                              | Archivo (variable, heavy for display)                       |
| Mono (numbers/filenames) | Fragment Mono                                                            | IBM Plex Mono                                                       | Space Mono                                                  |

## Architecture

- Themes are `[data-theme="<name>"]` token blocks in `src/themes/<name>.css`, imported from
  `src/index.css`. The existing semantic token names (shadcn vars) stay; components remain
  token-driven.
- `signal` is the default: its block uses `:root, [data-theme="signal"]`. Remove the old
  `.dark { … }` block and the old `:root` light values from `index.css` (keep the
  `@theme inline` mapping and `@custom-variant dark`).
- Dark handling: keep `@custom-variant dark`. Signal is the only dark theme; whenever the
  active theme is `signal`, `document.documentElement` also gets class `dark` (so existing
  `dark:` utilities keep working). Liner and pressing remove it.
- Pre-paint script: inline `<script>` in `index.html` `<head>` reads
  `localStorage["tagium:app-settings"]`, parses `.theme` (fallback `"signal"`), sets
  `document.documentElement.dataset.theme` and toggles `.dark`. Remove the hardcoded
  `class="dark"` from `<html>`. Must never throw (wrap in try/catch).
- Settings: add `theme: "liner" | "signal" | "pressing"` to `AppSettings`
  (`components/audio/types.ts`, `components/audio/settings.ts` schema, default `"signal"`).
  A `useEffect` (wherever settings state lives, e.g. `AudioTagger`) applies
  dataset.theme + dark class on change.
- Settings UI: new "appearance" section at the top of `SettingsPage`, matching the page's
  existing lowercase voice and control style: three selectable options (radio semantics),
  each a name + one-line description:
  - `liner` — "bright, sharp, ink on paper"
  - `signal` — "dark, warm, amber glow"
  - `pressing` — "bold two-ink print"
- Fonts via fontsource (bun add):
  `@fontsource-variable/libre-franklin`, `@fontsource/fragment-mono` (400),
  `@fontsource/barlow` (400/500/600/700), `@fontsource/ibm-plex-mono` (400/500),
  `@fontsource-variable/archivo` (the variable one incl. width axis), `@fontsource/space-mono`
  (400/700). Import all in `src/main.tsx`. (We load all three themes' fonts during the
  evaluation phase; strip losers once a winner is picked.)

### New theme-routed tokens

- `--wordmark-dot`: each theme's accent for the brand dot (see component tweaks).
- `--radius-hero` / `--radius-hero-inner`: radius of the landing dropzone and its inner
  icon tile (replaces hardcoded `rounded-3xl` / `rounded-2xl`).
- Fonts: each theme sets `--font-sans` and `--font-mono` (full fallback stacks).

### Shared component tweaks (theme-neutral, UX-identical)

1. **Wordmark dot**: `tagium` → `tagium<span style dot>.</span>` in both
   `TagSidebarPanel.tsx:155` and `LandingScreen.tsx:82`; dot color
   `text-(--wordmark-dot)`, `select-none`. Nothing else about the wordmark markup changes.
2. **Mono numerals**: track numbers in the sidebar list, and duration / file size in
   `TrackMetadataEditor`, get `font-mono tabular-nums` (sized ~0.9em so they sit with the
   UI text). Filenames shown in the editor header keep the sans but the `.mp3` suffix can
   stay muted as-is.
3. **Dropzone radii**: `LandingScreen.tsx` `rounded-3xl` → `rounded-(--radius-hero)`,
   inner tile `rounded-2xl` → `rounded-(--radius-hero-inner)`. Sweep for any other
   `rounded-2xl/3xl` hero-ish surfaces (cover art tile, upload-cover tile in
   `TrackMetadataEditor`) and route them through `--radius-hero-inner` as well.

Everything else stays token-driven — buttons, inputs, checkboxes, dialogs, popovers,
sonner toasts pick up their theme from the vars.

---

## Theme A — `liner` (light, archival)

Print catalog / liner-notes energy: cool paper, near-black ink, one electric cobalt
accent (a quiet nod to the cobalt engine). Flat: no shadows, hairline borders carry
structure.

```css
[data-theme="liner"] {
  --radius: 0.125rem; /* 2px — nearly sharp */
  --radius-hero: 0.25rem;
  --radius-hero-inner: 0.125rem;
  --background: oklch(0.978 0.003 264); /* cool paper */
  --foreground: oklch(0.22 0.015 264); /* ink */
  --card: oklch(0.99 0.002 264);
  --card-foreground: oklch(0.22 0.015 264);
  --popover: oklch(0.99 0.002 264);
  --popover-foreground: oklch(0.22 0.015 264);
  --primary: oklch(0.46 0.19 262); /* cobalt ink */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.93 0.01 264);
  --secondary-foreground: oklch(0.22 0.015 264);
  --muted: oklch(0.945 0.006 264);
  --muted-foreground: oklch(0.47 0.02 264);
  --accent: oklch(0.94 0.02 262); /* blue-tinted hover */
  --accent-foreground: oklch(0.3 0.08 262);
  --destructive: oklch(0.54 0.21 27);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.87 0.01 264);
  --input: oklch(0.87 0.01 264);
  --ring: oklch(0.46 0.19 262);
  --sidebar: oklch(0.955 0.005 264); /* cooler second neutral */
  --sidebar-foreground: oklch(0.22 0.015 264);
  --sidebar-primary: oklch(0.46 0.19 262);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.91 0.012 264);
  --sidebar-accent-foreground: oklch(0.22 0.015 264);
  --sidebar-border: oklch(0.88 0.01 264);
  --sidebar-ring: oklch(0.46 0.19 262);
  --wordmark-dot: oklch(0.46 0.19 262);
  --font-sans: "Libre Franklin Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, monospace;
  /* flat print: kill shadows */
  --shadow-2xs: 0 0 0 0 transparent;
  --shadow-xs: 0 0 0 0 transparent;
  --shadow-sm: 0 0 0 0 transparent;
  --shadow: 0 0 0 0 transparent;
  --shadow-md: 0 1px 2px 0 oklch(0.22 0.015 264 / 0.06);
  --shadow-lg: 0 2px 8px -2px oklch(0.22 0.015 264 / 0.1);
  --shadow-xl: 0 2px 12px -2px oklch(0.22 0.015 264 / 0.12);
  --shadow-2xl: 0 2px 16px -2px oklch(0.22 0.015 264 / 0.14);
  /* charts: cobalt ramp */
  --chart-1: oklch(0.46 0.19 262);
  --chart-2: oklch(0.6 0.15 262);
  --chart-3: oklch(0.72 0.1 262);
  --chart-4: oklch(0.35 0.15 262);
  --chart-5: oklch(0.82 0.06 262);
}
```

Per-theme CSS (same file, scoped `[data-theme="liner"]`):

- Popovers/dialogs rely on their 1px border (they already have `border`); the soft
  `--shadow-lg` above is enough. No extra elevation.
- No glow, no gradients anywhere.

Contrast receipts: ink/paper 16.3, muted-fg/paper 6.4, white/cobalt 7.1, cobalt/paper 7.0,
white/destructive 5.4.

## Theme B — `signal` (dark, warm, default)

Hi-fi hardware at night, not a terminal: warm near-black chassis, amber signal used only
for primary action / selection / focus. Soft radii, gentle layered elevation, a faint
amber glow only on the primary button's hover.

```css
:root,
[data-theme="signal"] {
  --radius: 0.75rem;
  --radius-hero: 1.5rem;
  --radius-hero-inner: 1rem;
  --background: oklch(0.165 0.008 70); /* warm black, face */
  --foreground: oklch(0.93 0.012 80);
  --card: oklch(0.205 0.01 70);
  --card-foreground: oklch(0.93 0.012 80);
  --popover: oklch(0.21 0.01 70);
  --popover-foreground: oklch(0.93 0.012 80);
  --primary: oklch(0.78 0.145 70); /* amber */
  --primary-foreground: oklch(0.2 0.03 70);
  --secondary: oklch(0.28 0.015 70);
  --secondary-foreground: oklch(0.9 0.01 80);
  --muted: oklch(0.26 0.012 70);
  --muted-foreground: oklch(0.72 0.02 75);
  --accent: oklch(0.25 0.02 70);
  --accent-foreground: oklch(0.9 0.01 80);
  --destructive: oklch(0.55 0.19 25);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.27 0.012 70);
  --input: oklch(0.24 0.012 70);
  --ring: oklch(0.78 0.145 70);
  --sidebar: oklch(0.14 0.008 70); /* darker chassis */
  --sidebar-foreground: oklch(0.93 0.012 80);
  --sidebar-primary: oklch(0.78 0.145 70);
  --sidebar-primary-foreground: oklch(0.2 0.03 70);
  --sidebar-accent: oklch(0.22 0.012 70);
  --sidebar-accent-foreground: oklch(0.93 0.012 80);
  --sidebar-border: oklch(0.24 0.012 70);
  --sidebar-ring: oklch(0.78 0.145 70);
  --wordmark-dot: oklch(0.78 0.145 70);
  --font-sans: "Barlow", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
  /* soft real elevation for dark */
  --shadow-2xs: 0 1px 2px 0 oklch(0 0 0 / 0.2);
  --shadow-xs: 0 1px 3px 0 oklch(0 0 0 / 0.25);
  --shadow-sm: 0 2px 6px -1px oklch(0 0 0 / 0.3);
  --shadow: 0 2px 6px -1px oklch(0 0 0 / 0.3);
  --shadow-md: 0 4px 10px -2px oklch(0 0 0 / 0.35);
  --shadow-lg: 0 8px 20px -4px oklch(0 0 0 / 0.4);
  --shadow-xl: 0 12px 28px -6px oklch(0 0 0 / 0.45);
  --shadow-2xl: 0 16px 40px -8px oklch(0 0 0 / 0.5);
  --chart-1: oklch(0.78 0.145 70);
  --chart-2: oklch(0.65 0.12 70);
  --chart-3: oklch(0.52 0.09 70);
  --chart-4: oklch(0.86 0.09 75);
  --chart-5: oklch(0.4 0.06 70);
}
```

Per-theme CSS:

- Primary button hover: `[data-theme="signal"] [data-slot="button"]` with the default
  variant… simplest robust hook: `:root:not([data-theme="liner"]):not([data-theme="pressing"])`
  is ugly — instead scope with `[data-theme="signal"]`, and ALSO duplicate under
  `html:not([data-theme])` if needed. (The pre-paint script always sets data-theme, so
  plain `[data-theme="signal"]` is fine.) Rule:
  `[data-theme="signal"] [data-slot="button"].bg-primary:hover` is brittle — instead add
  the glow via a token: define `--glow-primary: 0 0 24px oklch(0.78 0.145 70 / 0.22)` and
  have button.tsx default variant use `hover:shadow-(--glow-primary)` (other themes set
  `--glow-primary: 0 0 0 0 transparent`). One-line component change, token-driven.

Contrast receipts: fg/bg 15.7, muted-fg/bg 7.8 (7.2 on card), dark-on-amber 8.8,
amber/bg 9.4, white/destructive 5.1.

## Theme C — `pressing` (committed color, riso print)

Two-ink risograph: ultramarine + fluorescent coral on paper. The sidebar is drenched in
ultramarine (the chrome carries the color); content sits on paper. Flat — no shadows;
2px ink lines and pill buttons do the work. NOT neo-brutalism: no hard offset shadows.

Coral rule: coral is large/bold-text-and-marker only (3.7:1 on paper). Body-size coral
text is banned; coral fills carry bold ≥14px ink text (4.1:1) or serve as non-text
selection markers (needs only 3:1).

```css
[data-theme="pressing"] {
  --radius: 0.375rem; /* 6px controls; buttons pill via override */
  --radius-hero: 0.75rem;
  --radius-hero-inner: 0.5rem;
  --background: oklch(0.975 0.004 264); /* riso paper (cool white) */
  --foreground: oklch(0.24 0.02 264); /* ink */
  --card: oklch(0.99 0.002 264);
  --card-foreground: oklch(0.24 0.02 264);
  --popover: oklch(0.99 0.002 264);
  --popover-foreground: oklch(0.24 0.02 264);
  --primary: oklch(0.44 0.18 264); /* ultramarine ink */
  --primary-foreground: oklch(0.97 0.01 264);
  --secondary: oklch(0.9 0.03 264); /* paper tinted by blue ink */
  --secondary-foreground: oklch(0.24 0.02 264);
  --muted: oklch(0.93 0.015 264);
  --muted-foreground: oklch(0.45 0.03 264);
  --accent: oklch(0.9 0.045 264); /* hover: heavier blue tint */
  --accent-foreground: oklch(0.24 0.02 264);
  --destructive: oklch(0.5 0.2 27);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.82 0.03 264);
  --input: oklch(0.6 0.05 264); /* visible ink outline on inputs */
  --ring: oklch(0.62 0.21 30); /* coral focus */
  --sidebar: oklch(0.44 0.17 264); /* DRENCHED ultramarine */
  --sidebar-foreground: oklch(0.97 0.01 264);
  --sidebar-primary: oklch(0.62 0.21 30); /* coral */
  --sidebar-primary-foreground: oklch(0.24 0.02 264);
  --sidebar-accent: oklch(0.38 0.15 264); /* selected/hover well */
  --sidebar-accent-foreground: oklch(0.97 0.01 264);
  --sidebar-border: oklch(0.52 0.14 264);
  --sidebar-ring: oklch(0.62 0.21 30);
  --wordmark-dot: oklch(0.62 0.21 30); /* coral: pops on paper AND ultramarine */
  --font-sans: "Archivo Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Space Mono", ui-monospace, SFMono-Regular, monospace;
  --glow-primary: 0 0 0 0 transparent;
  /* flat print */
  --shadow-2xs: 0 0 0 0 transparent;
  --shadow-xs: 0 0 0 0 transparent;
  --shadow-sm: 0 0 0 0 transparent;
  --shadow: 0 0 0 0 transparent;
  --shadow-md: 0 0 0 0 transparent;
  --shadow-lg: 0 2px 10px -2px oklch(0.24 0.02 264 / 0.12);
  --shadow-xl: 0 2px 14px -2px oklch(0.24 0.02 264 / 0.14);
  --shadow-2xl: 0 2px 18px -2px oklch(0.24 0.02 264 / 0.16);
  --chart-1: oklch(0.44 0.18 264);
  --chart-2: oklch(0.62 0.21 30);
  --chart-3: oklch(0.62 0.12 264);
  --chart-4: oklch(0.78 0.07 264);
  --chart-5: oklch(0.35 0.14 264);
}
```

Per-theme CSS (scoped `[data-theme="pressing"]`):

- Pill buttons: `[data-theme="pressing"] [data-slot="button"] { border-radius: 9999px; font-weight: 700; }`
- Buttons/outline: 2px ink border — `[data-theme="pressing"] [data-slot="button"][class*="border"] { border-width: 2px; border-color: var(--foreground); }`
  (verify against actual outline-variant classes; adjust selector to whatever is robust).
- Wordmark: heavy + wide — `[data-theme="pressing"] h1, [data-theme="pressing"] .wordmark`
  → prefer adding a `.wordmark` class to the two wordmark elements (shared tweak) and:
  `{ font-weight: 900; font-stretch: 125%; letter-spacing: -0.01em; }` (Archivo Variable
  has a width axis).
- Checkbox/selected states may use coral fills with ink glyphs.

Contrast receipts: ink/paper 15.3, muted-fg/paper 6.9, white/ultramarine 7.4,
sidebar-fg/sidebar 7.4, ink/coral 4.1 (bold ≥14px only), coral/paper 3.7 (large/markers
only), white/destructive 6.4.

---

## Verification checklist (after implementation)

1. `bun run typecheck` && `bun run lint` && `bun run test` pass.
2. Theme switcher in settings switches instantly, persists across reload, no flash of
   wrong theme on load (pre-paint script).
3. Screenshots (landing / editor / settings / mobile) per theme look right; no clipped
   text, no unreadable pairs, dashed dropzone visible on all three backgrounds.
4. `prefers-reduced-motion` behavior unchanged.
5. Existing e2e specs unaffected (no renamed roles/labels).
