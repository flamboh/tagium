import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  audioFixtures,
  imageFixtures,
  type AudioFixtureName,
  type ImageFixtureName,
} from "../../fixtures/catalog.ts";

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
