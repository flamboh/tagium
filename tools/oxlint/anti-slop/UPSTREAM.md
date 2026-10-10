# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (merge of #36, 2026-09-10), copied from `skills/install-anti-slop/assets/anti-slop/` (identical to `src/` minus tests).

Previous base: commit `9b80d9a` ("feat: enforce explicit test and assertion boundaries"), recovered by matching every vendored file byte-for-byte except the local deviations below.

## Local deviations

- `rules/no-module-mocking.ts`: also treats `vi` imported from `vite-plus/test` as the Vitest framework object.
- `rules/no-runtime-typeof.ts`: also allows `typeof value === "function"` capability checks. The rule is disabled in `vite.config.ts`; the deviation is kept so re-enabling it does not flag capability detection.

## Configuration

All upstream generic rules and the opt-in Effect plugin (`effect/index.ts`, registered as `anti-slop-effect`) are enabled in `vite.config.ts`, together with the native `oxc/no-accumulating-spread` companion rule. Repository-specific severities and overrides live there.

`@oxlint/plugins` is pinned to the `oxlint` version bundled with `vite-plus`.
