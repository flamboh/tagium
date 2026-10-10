import type { Registry } from "../registry.ts";

export type FakeRequest = {
  registry: Registry;
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
  bodyBytes: Uint8Array | undefined;
};

export type FakeResult = {
  route: string;
  key: string | null;
  response: Response | Promise<Response>;
  body?: string;
  unexpected?: boolean;
};

export const unexpected = (route: string, key: string | null = null): FakeResult => ({
  route,
  key,
  unexpected: true,
  response: new Response(`e2e harness: unexpected upstream request (${route})`, { status: 599 }),
});

export const hangThenFail = async (registry: Registry, key: string) => {
  await registry.hang(key);
  return new Response("e2e harness: hung request released", { status: 599 });
};
