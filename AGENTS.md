# AGENTS.md

Tagium is a web-based audio metadata editor. We allow users to save the tracks they love and edit their metadata locally in the browser.

- This repo uses Vite+ `vp` and Bun to build and run the application.
- A Cobalt API instance is used to save audio files from sites like SoundCloud and YouTube.
- Cobalt is set with `localProcessing: "forced"` for our use case, Cobalt API is a download proxy only.
- Backend code, such as metadata editing and track downloading, is written with EffectTS.
- `.repos/*` contains git subtrees to reference external repositories. Never modify anything in `.repos/*` directly.
- When instructed to create a "stacked PR", use Graphite `gt` to create said PR.

## Pull Requests

Every PR must include brief, plain-language instructions for human review that provide a fast path to approval. Include:

- The UI flows to exercise, any required setup or test data, and the expected result.
- Important edge cases or failure states worth checking.
- Business-logic decisions, assumptions, or tradeoffs that need reviewer consideration.
- What was verified automatically and anything that still requires manual verification.

Keep this guidance focused on observable behavior and decisions rather than an exhaustive summary of the implementation. Omit items that do not apply.

## References

- When writing EffectTS code, explore `.repos/effect`
- Vite+ (vp) docs `https://viteplus.dev/guide/`
