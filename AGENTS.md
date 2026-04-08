# AGENTS.md

Generally speaking, you should browse the codebase to figure out what is going on.

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- Never use `bun test`, use `bun run test` (runs Vitest).
- Never write a $effect. If you really think you need to, see the no-use-effect skill.

## Project Snapshot

EQdle is a wordle-like game for guessing EQ bands and descriptors for audio clips.
It uses Text2FX and CLAP embeddings to generate audio clips and EQ params.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Visual consistency first. Adhere to the visual style of the existing site.

If a tradeoff is required, choose correctness and robustness over short-term convenience.

Do not add excessive fallbacks. Errors like missing env are critical and shouldn't be masked by fallbacks. Logic should be simple, with reasonable expecations, don't `try except` everything. Use the smallest possible diff. Then think of how to make it smaller. Don't add helpers. Do not use fallbacks with ternaries or the || operator. No typeof checks. No backwards compatability. Smallest possible set of changes to make the instructed change work.

Keep files under ~400 lines. Refactor as neeeded to meet this.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there are shared logic that can be extracted to a separate module. Duplicate logic across mulitple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `src/`: SvelteKit frontend

## Expectations

- Use shadcn for base components `bunx shadcn-svelte@latest add {component}`
- Use dark mode color scheme in src/styles.css
- Keep designs simple, no over explaining, plain colors, no gradients, no decorative elements.
- Assume dev servers for both Convex and `bun dev` are already running.

## References

- Skills: use ~/.agents/skills/find-skills to locate relevant skills wherever possible
- Visual style and audio component design: ~/Code/oss/destruct-web
