import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
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
  pageCrashes: string[];
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

  pageCrashes: async ({ browserName }, provide) => {
    const crashes: string[] = [];
    await provide(crashes);
    if (crashes.length > 0) {
      throw new Error(
        `the ${browserName} page crashed (renderer or web content process died) at ${crashes.join(", ")}. this is a browser crash, not a slow step`,
      );
    }
  },

  sandbox: async ({ baseURL, upstreams, seenFeatures, pageCrashes }, provide) => {
    const appOrigin = new URL(baseURL!).origin;
    await provide(async (context) => {
      const watch = (page: Page) =>
        page.on("crash", () => {
          pageCrashes.push(page.url());
          void page.close().catch(() => {});
        });
      context.pages().forEach(watch);
      context.on("page", watch);
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

export const TEST_TIMEOUT = 60_000;
export const JOURNEY_TIMEOUT = 110_000;
export const EXPECT_TIMEOUT = 10_000;
export const IMPORT_TIMEOUT = { timeout: 20_000 };
export const SETTLE_TIMEOUT = { timeout: 45_000 };

export const journey = () => test.setTimeout(JOURNEY_TIMEOUT);

export const downloadNames = (name: string) =>
  test.info().project.name === "webkit" ? [name, name.replaceAll(" ", "_")] : [name];

export const expectDownloadName = (file: { filename: string }, name: string) =>
  expect(downloadNames(name)).toContain(file.filename);

export { expect };
