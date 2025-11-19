# Repository Guidelines

## Project Structure & Module Organization
Tagium is a Next.js App Router project focused on browser-side audio tag editing. Keep feature-specific UI in `components/audio/`, shared primitives in `components/ui/`, and cross-cutting helpers in `lib/`. Page shells and global styles live under `app/`, while static assets remain in `public/`. Prefer colocating supporting files (schemas, hooks, styles) next to the component they serve and exporting through `@/` aliases for clarity.

## Build, Test, and Development Commands
Install dependencies once with `pnpm install`. Everyday commands:
- `pnpm dev` starts the Turbopack-powered dev server on `localhost:3000`.
- `pnpm build` performs a production bundle; use it before shipping changes.
- `pnpm start` serves the previously built bundle.
- `pnpm lint` / `pnpm lint:fix` enforce the Next.js ESLint rules.
- `pnpm typecheck` runs `tsc --noEmit` to surface type regressions even though builds skip type errors.

## Coding Style & Naming Conventions
Use TypeScript with functional React components. Follow two-space indentation, PascalCase component files (`AudioUpload.tsx`), and camelCase utilities. Styling relies on Tailwind CSS v4; compose class names with the `cn` helper instead of manual string concatenation. Group React hooks near the top of a component, validate runtime data with `zod`, and keep side effects wrapped in handlers. Always fix lint and type warnings locally, because `next.config.ts` currently allows builds to succeed despite issues.

## Testing Guidelines
There is no automated test harness yet. Before opening a PR, run through critical flows: upload an audio file, edit metadata, update cover art, and re-download. When adding tests, prefer React Testing Library with Jest or Vitest, mirror the `app/` route structure under `__tests__/`, and name files `*.test.tsx`. Document new test commands in `package.json`.

## Commit & Pull Request Guidelines
Commit messages in history are short, present-tense verbs (`remove unused tagform`). Keep summaries under 72 characters and scope grouped changes together. For each PR, include: a concise problem statement, bullet list of changes, manual test notes, and UI screenshots or screen recordings when behavior shifts. Link relevant issues and request review from maintainers responsible for the affected directory.

## Security & Configuration Tips
Do not commit audio assets containing personal data; use placeholder tracks under `public/` instead. Review third-party dependency upgrades carefully, especially `music-metadata` and `mp3tag.js`. Keep environment-specific secrets out of source control and load them through `.env.local`, which Next.js ignores by default.
