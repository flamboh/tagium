import type { APIRequestContext } from "@playwright/test";
import { expect, IMPORT_TIMEOUT, journey, JOURNEY_TIMEOUT, test as base } from "../support/test";

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ playwright, baseURL }, provide) => {
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { connection: "close" },
    });

    await provide(context);
    await context.dispose();
  },
});

export { expect, IMPORT_TIMEOUT, journey, JOURNEY_TIMEOUT };
