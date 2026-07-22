# Share-link operations

Share links are unavailable immediately when their D1 row is disabled or reaches its 90-day expiry. R2 artwork deletion becomes eligible at 90 days and Cloudflare completes lifecycle deletion asynchronously (typically within the following day); it is not the availability control. The D1 row is retained only as minimal operational lifecycle metadata after expiry, so product copy must promise a **90-day link lifetime**, not instantaneous physical deletion of every record at the expiry timestamp.

## Disable or takedown

Use a maintainer credential with access only to the intended environment. This command is deliberately explicit and does not run in normal application traffic:

```sh
TAGIUM_DEPLOY_ENV=production SHARE_MAINTAINER_CONFIRM=disable \
  bun run disable:share-manifest -- <22-character-slug>
```

It validates the environment and server-derived key, disables the D1 row first, then deletes the corresponding R2 object. A missing or previously-disabled row is safe to retry. If R2 deletion fails, the link remains disabled; repeat the exact command once R2 is available. Never use preview resource values for production (or vice versa).

Both deployment commands fail closed unless their isolated D1/R2 bindings, the additive D1 migration, and the verified 90-day R2 lifecycle rule are present.
