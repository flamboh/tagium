import {
  manifestContentTitle,
  normalizeContentTitle,
} from "../../src/features/share/shareContentTitle";
import { manifestTrackCount, type Manifest } from "../../src/features/share/shareManifest";

const config = {
  key: import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
  host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  deployEnv: import.meta.env.VITE_PUBLIC_DEPLOY_ENV,
  releaseSha: import.meta.env.VITE_PUBLIC_RELEASE_SHA,
};

interface ShareCreatedProperties {
  $process_person_profile: false;
  event_version: 1;
  deploy_env: string;
  app_id: "tagium";
  release_sha?: string;
  share_id: string;
  share_kind: Manifest["kind"];
  track_count: number;
  content_title?: string;
}

export const captureShareCreated = async (analyticsId: string, manifest: Manifest) => {
  if (!config.key || !config.host || config.deployEnv !== "production") return;

  const properties: ShareCreatedProperties = {
    $process_person_profile: false,
    event_version: 1,
    deploy_env: config.deployEnv,
    app_id: "tagium",
    share_id: analyticsId,
    share_kind: manifest.kind,
    track_count: manifestTrackCount(manifest),
  };

  const contentTitle = normalizeContentTitle(manifestContentTitle(manifest));

  if (config.releaseSha) properties.release_sha = config.releaseSha;

  if (contentTitle) properties.content_title = contentTitle;

  try {
    await fetch(new URL("/i/v0/e/", config.host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: config.key,
        event: "share_created",
        distinct_id: analyticsId,
        timestamp: new Date().toISOString(),
        properties,
      }),
    });
  } catch {
    return;
  }
};
