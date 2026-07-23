# Share-link operations

Share links are unavailable immediately when their D1 row is disabled or reaches its 90-day expiry. R2 artwork deletion becomes eligible at 90 days and Cloudflare completes lifecycle deletion asynchronously (typically within the following day); it is not the availability control. The D1 row is retained only as minimal operational lifecycle metadata after expiry, so product copy must promise a **90-day link lifetime**, not instantaneous physical deletion of every record at the expiry timestamp.

## Deployments and one-time setup

The committed `scripts/share-deployment-bindings.ts` target map is the binding source of truth. Preview and production use separate, stable D1 databases, R2 buckets, and rate-limit namespaces; no `SHARE_PREVIEW_*` build variables or Prisma are used. Native Workers Builds should use exactly:

```sh
bun install --frozen-lockfile
bun run build:cloudflare
```

`build:cloudflare` maps `WORKERS_CI_BRANCH=main` (or `master`) to production and every other branch to preview; it maps `WORKERS_CI_COMMIT_SHA` to `VITE_PUBLIC_RELEASE_SHA`, enables share links, and passes through `VITE_PUBLIC_POSTHOG_HOST` and `VITE_PUBLIC_POSTHOG_KEY`. Workers Builds supplies Bun **1.3.10**. For a manual non-production upload (including a safe config-only check), use `bun run deploy:preview` (add `--no-upload`); production uses `bun run deploy:production` (add `--no-upload`). These commands only materialize and validate generated config, then upload/deploy; they never mutate D1 or R2.

Run these reviewed, fail-closed commands once per environment, and again only when intentionally changing infrastructure:

```sh
TAGIUM_DEPLOY_ENV=preview bun run migrate:share:preview
TAGIUM_DEPLOY_ENV=preview bun run configure:share-artwork-lifecycle:preview
TAGIUM_DEPLOY_ENV=production bun run migrate:share:production
TAGIUM_DEPLOY_ENV=production bun run configure:share-artwork-lifecycle:production
```

There is one Worker service named `tagium`. Preview uses `wrangler versions upload` and production uses `wrangler deploy` against that same service; no named Wrangler environments are used, so production routes remain attached to `tagium`.

Cloudflare Build variables still required: `WORKERS_CI_BRANCH`, `WORKERS_CI_COMMIT_SHA`, `VITE_PUBLIC_POSTHOG_HOST`, and `VITE_PUBLIC_POSTHOG_KEY`. Deploy credentials (`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`) are supplied by the operator or Workers Build environment.

## Disable or takedown

Use a maintainer credential with access only to the intended environment. This command is deliberately explicit and does not run in normal application traffic:

```sh
TAGIUM_DEPLOY_ENV=production SHARE_MAINTAINER_CONFIRM=disable \
  bun run disable:share-manifest -- <22-character-slug>
```

It validates the environment and server-derived key, disables the D1 row first, then deletes the corresponding R2 object. A missing or previously-disabled row is safe to retry. If R2 deletion fails, the link remains disabled; repeat the exact command once R2 is available. Never use preview resource values for production (or vice versa).

Both deployment commands fail closed unless their isolated D1/R2 bindings, the additive D1 migration, and the verified 90-day R2 lifecycle rule are present.
