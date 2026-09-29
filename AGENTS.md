# AGENTS.md

Tagium is a web-based audio metadata editor. We allow users to save the tracks they love and edit their metadata locally in the browser.

- This repo uses Vite+ `vp` and Bun to build and run the application.
- A Cobalt API instance is used to save audio files from sites like SoundCloud and YouTube.
- Cobalt is set with `localProcessing: "forced"` for our use case, Cobalt API is a download proxy only.
- Backend code, such as metadata editing and track downloading, is written with EffectTS.
- `.repos/*` contains git subtrees to reference external repositories. Never modify anything in `.repos/*` directly.
- When instructed to create a "stacked PR", use Graphite `gt` to create said PR.
- For UI work, use established shadcn components and import new components where applicable.
- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations. Very little state in this application persists between sessions, so this is pretty safe.
- Keep all UI copy lowercase, including accessibility text, brands, acronyms, and units. Preserve placeholder casing and user/provider content; don't fake casing with CSS.

## Pull requests

Include a short human review guide with relevant flows, setup or test data, expected behavior, important edge cases, and decisions needing review. Distinguish automated verification from remaining manual checks.

## References

- When writing EffectTS code, explore `.repos/effect`
- Vite+ (vp) docs `https://viteplus.dev/guide/`
