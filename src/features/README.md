# Feature modules

Frontend product code is grouped by behavior instead of by file type:

- `audio`: local audio metadata and MP3 processing
- `editor`: track, album, and cover-art editing
- `export`: validation and file export
- `import`: uploads, URL imports, Cobalt, and download queues
- `library`: albums, tracks, sidebar state, and library operations
- `settings`: settings persistence and UI
- `workspace`: application-level UI composition and state

Reusable visual primitives belong in `src/components/ui`. Development-only UI belongs in
`src/components/dev`.

Feature folders indicate ownership and make behavior discoverable; they are not strict isolation.
Put new code with the feature it implements, and use genuine cross-feature imports through the
`@/features/...` alias. Tests mirror these modules under `tests/unit/features`; server and browser
tests live in `tests/server` and `tests/e2e`.
