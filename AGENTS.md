# AGENTS.md

Tagium is a web-based audio metadata editor. We allow users to save the tracks they love and edit their metadata locally in the browser.

- This repo uses Vite+ `vp` and Bun to build and run the application.
- A Cobalt API instance is used to save audio files from sites like SoundCloud and YouTube.
- Backend code, such as metadata editing and track downloading, is written with EffectTS.
- `repos/*` contains git subtrees to reference external repositories. Never modify anything in `repos/*` directly.
- When instructed to create a "stacked PR", use Graphite `gt` to create said PR.

## References

- When writing EffectTS code, explore `repos/effect`
- Skills: use ~/.agents/skills/find-skills to locate relevant skills wherever possible
- Vite+ (vp) docs `https://viteplus.dev/guide/`
