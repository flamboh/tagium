import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  audioFixtures,
  imageFixtures,
  mediaFixtures,
  type AudioFixtureName,
  type ImageFixtureName,
  type MediaFixtureName,
} from "../../fixtures/catalog.ts";
import type { PostAsset } from "../protocol.ts";

const fixturePath = (file: string) =>
  fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url));

const audio = Object.fromEntries(
  Object.entries(audioFixtures).map(([name, fixture]) => [
    name,
    new Uint8Array(readFileSync(fixturePath(fixture.stream))),
  ]),
) as Record<AudioFixtureName, Uint8Array<ArrayBuffer>>;

const images = Object.fromEntries(
  Object.entries(imageFixtures).map(([name, fixture]) => [
    name,
    new Uint8Array(readFileSync(fixturePath(fixture.file))),
  ]),
) as Record<ImageFixtureName, Uint8Array<ArrayBuffer>>;

const media = Object.fromEntries(
  Object.entries(mediaFixtures).map(([name, fixture]) => [
    name,
    new Uint8Array(readFileSync(fixturePath(fixture.file))),
  ]),
) as Record<MediaFixtureName, Uint8Array<ArrayBuffer>>;

const font = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
        import.meta.url,
      ),
    ),
  ),
);

export const audioResponse = (name: AudioFixtureName) =>
  new Response(audio[name], {
    headers: {
      "content-type": audioFixtures[name].mime,
      "content-length": String(audio[name].byteLength),
      "estimated-content-length": String(audio[name].byteLength),
    },
  });

export const imageResponse = (name: ImageFixtureName) =>
  new Response(images[name], {
    headers: {
      "content-type": imageFixtures[name].mime,
      "content-length": String(images[name].byteLength),
    },
  });

const asset = (name: PostAsset) => {
  if (name in media) {
    const key = name as MediaFixtureName;

    return { bytes: media[key], mime: mediaFixtures[key].mime };
  }

  if (name in images) {
    const key = name as ImageFixtureName;

    return { bytes: images[key], mime: imageFixtures[key].mime };
  }

  const key = name as AudioFixtureName;

  return { bytes: audio[key], mime: audioFixtures[key].mime };
};

export const assetResponse = (name: PostAsset) => {
  const { bytes, mime } = asset(name);

  return new Response(bytes, {
    headers: {
      "content-type": mime,
      "content-length": String(bytes.byteLength),
      "estimated-content-length": String(bytes.byteLength),
    },
  });
};

export const stalledAssetResponse = (
  name: PostAsset,
  sent: number | undefined,
  stall: () => Promise<void>,
) => {
  const { bytes, mime } = asset(name);
  const head = bytes.slice(0, Math.min(sent ?? Math.floor(bytes.byteLength / 2), bytes.byteLength));
  let pulls = 0;

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1;

        if (pulls === 1) {
          controller.enqueue(head);

          return;
        }

        await stall();
        controller.error(new Error("e2e harness: stalled tunnel released"));
      },
    }),
    {
      headers: {
        "content-type": mime,
        "estimated-content-length": String(bytes.byteLength),
      },
    },
  );
};

export const fontResponse = () => new Response(font, { headers: { "content-type": "font/ttf" } });

export const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), { ...init, headers });
};

export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
