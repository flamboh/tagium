import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "tagium youtube prototype",
    description: "import audio through your own connection, with per-download approval",
    host_permissions: ["https://www.youtube.com/*", "https://*.googlevideo.com/*"],
    browser_specific_settings: {
      gecko: {
        id: "youtube-prototype@tagium.app",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
      },
    },
  },
});
