/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
  readonly VITE_PUBLIC_DEPLOY_ENV?: string;
  readonly VITE_PUBLIC_RELEASE_SHA?: string;
  readonly VITE_PUBLIC_SHARE_LINKS_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
