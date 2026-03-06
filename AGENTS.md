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
- Test MP3 files are pre-generated at `/tmp/test-mp3s/` by the update script (via ffmpeg). They include:
  - **Album "Ocean Dreams"** by The Waves: `morning_light.mp3`, `tidal_flow.mp3`, `coral_reef.mp3` (tracks 1-3, Ambient, 2024)
  - **Album "Synthwave Nights"** by Pixel Runner: `neon_city.mp3`, `retrograde.mp3` (tracks 1-2, Electronic, 2023)
  - **Loose track** (no album): `lonely_road.mp3` by Solo Drifter (Folk, 2025)
- Upload multiple files from the same album to test album grouping, track reordering, and batch metadata logic.
