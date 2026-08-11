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
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason. e.g. modify shadcn components instead of creating custom solutions.
- Keep all UI copy lowercase, including accessibility text, brands, acronyms, and units. Preserve placeholder casing and user/provider content; don't fake casing with CSS.

## Pull Requests

Every PR must include brief, plain-language instructions for human review that provide a fast path to approval. Include:

- The UI flows to exercise, any required setup or test data, and the expected result.
- Important edge cases or failure states worth checking.
- Business-logic decisions, assumptions, or tradeoffs that need reviewer consideration.
- What was verified automatically and anything that still requires manual verification.

Keep this guidance focused on observable behavior and decisions rather than an exhaustive summary of the implementation.

## References

- When writing EffectTS code, explore `.repos/effect`
- Vite+ (vp) docs `https://viteplus.dev/guide/`
