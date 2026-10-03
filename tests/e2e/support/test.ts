import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { test as base, expect, type BrowserContext } from "@playwright/test";
import {
  FEATURE_DISCOVERY_STORAGE_KEY,
  type DiscoverableFeature,
} from "../../../src/features/discovery/featureDiscovery";
import { E2E_CONTROL_URL, type UpstreamCall } from "../harness/protocol.ts";
import { createUpstreams, type Upstreams } from "./upstreams.ts";

const describeCall = (call: UpstreamCall) =>
  `  ${call.origin} ${call.method} ${call.url} -> ${call.status} (${call.route}${call.owner ? "" : ", unattributed: may come from a concurrent test"})`;

type HarnessFixtures = {
  upstreams: Upstreams;
  seenFeatures: DiscoverableFeature[];
  sandbox: (context: BrowserContext) => Promise<void>;
  newContext: () => Promise<BrowserContext>;
};

export const test = base.extend<HarnessFixtures>({
  seenFeatures: [["share-links"], { option: true }],

  upstreams: async ({}, provide, testInfo) => {
    const upstreams = createUpstreams(`${testInfo.testId}-${testInfo.retry}-${randomUUID()}`);
    const startedAt = Date.now();
    try {
      await provide(upstreams);
      const unexpected = await upstreams.unexpectedCallsSince(startedAt);
      if (unexpected.length > 0) {
        throw new Error(
          `unexpected upstream calls (register a scenario for them):\n${unexpected.map(describeCall).join("\n")}`,
        );
      }
    } finally {
      await upstreams.release();
    }
  },

  sandbox: async ({ baseURL, upstreams, seenFeatures }, provide) => {
    const appOrigin = new URL(baseURL!).origin;
    await provide(async (context) => {
      await context.addInitScript(
        ({ key, value }) => {
          Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
          Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        },
        {
          key: FEATURE_DISCOVERY_STORAGE_KEY,
          value: JSON.stringify(Object.fromEntries(seenFeatures.map((feature) => [feature, true]))),
        },
      );
      await context.route(
        (url) => url.origin !== appOrigin,
        async (route) => {
          const request = route.request();
          const postData = request.postDataBuffer();
          const response = await fetch(`${E2E_CONTROL_URL}/browser-upstream`, {
            method: "POST",
            headers: {
              "x-e2e-url": request.url(),
              "x-e2e-method": request.method(),
              "x-e2e-owner": upstreams.owner,
            },
            body: postData ? new Uint8Array(postData) : undefined,
          });
          await route.fulfill({
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers),
              "access-control-allow-origin": "*",
            },
            body: Buffer.from(await response.arrayBuffer()),
          });
        },
      );
    });
  },

  context: async ({ context, sandbox }, provide) => {
    await sandbox(context);
    await provide(context);
  },

  newContext: async (
    {
      browser,
      contextOptions,
      sandbox,
      baseURL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
    },
    provide,
  ) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext({
        ...contextOptions,
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
      });
      contexts.push(context);
      await sandbox(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export const IMPORT_TIMEOUT = { timeout: 60_000 };

export { expect };
