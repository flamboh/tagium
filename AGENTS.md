# AGENTS.md

## Cursor Cloud specific instructions

**Tagium** is a client-side MP3/ID3 tag editor built as a single Next.js frontend app. There is no backend, database, or external services.

### Key commands

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` (Turbopack, port 3000) |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |

### Notes

- All MP3 processing happens client-side via `mp3tag.js`; no server-side logic exists.
- The `pnpm-workspace.yaml` restricts build scripts via `onlyBuiltDependencies`. If `pnpm install` warns about ignored build scripts, this is expected and does not affect development.
- No `.env` file or secrets are required.
- To manually test the app, create an MP3 file (e.g. `ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -metadata title="Test" -y /tmp/test.mp3`) and upload it through the UI.
