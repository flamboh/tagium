import { wrapRequestHandler } from "@sentry/cloudflare";

type SentryOptions = Parameters<typeof wrapRequestHandler>[0]["options"];
export type SentryEvent = Parameters<NonNullable<SentryOptions["beforeSend"]>>[0];

export const captureSentryEvents = async (run: () => void | Promise<void>) => {
  const events: SentryEvent[] = [];
  await wrapRequestHandler(
    {
      options: {
        dsn: "https://public@sentry.test/1",
        defaultIntegrations: false,
        beforeSend: (event) => {
          events.push(event);
          return null;
        },
      },
      request: new Request("https://tagium.test/api/cobalt/test"),
      context: undefined,
    },
    async () => {
      await run();
      return new Response(null);
    },
  );
  return events;
};
