import { audioFixture, expectLosslessAudio, inspectAudio } from "../support/audio";
import { probeMedia } from "../support/media";
import { expect, journey, test } from "../support/test";
import { saveApp } from "./save";

test("saves youtube audio as a tagged mp3 with its cover", async ({ page, upstreams }) => {
  const video = await upstreams.youtube.video({ title: "Café 東京 🎧", author: "Ártist / Duo" });
  const save = saveApp(page);
  const filename = "Café 東京 🎧 - Ártist ／ Duo (youtube).mp3";

  await save.open();
  await save.configure({ mode: "audio", audio: "mp3" });
  await save.save(video.url, filename);
  await expect(save.rows.locator("img[data-save-download-cover-state=loaded]")).toHaveCount(1);

  const file = await save.download(filename);
  const { format, metadata } = await inspectAudio(file);
  expect(format).toBe("mp3");
  expect(metadata).toMatchObject({ title: "Café 東京 🎧", artist: "Ártist / Duo" });
  expect(metadata.picture).toHaveLength(1);
  const media = await probeMedia(file);
  expect(media.streams).toContainEqual(expect.objectContaining({ type: "audio", codec: "mp3" }));
  expect(media.streams.find((stream) => stream.type === "audio")?.frames).toBeGreaterThan(0);
  expect(media.duration).toBeCloseTo(2, 0);

  const [resolve] = await upstreams.calls({ route: "cobalt.resolve" });
  expect(JSON.parse(resolve!.requestBody!)).toMatchObject({
    downloadMode: "audio",
    audioFormat: "mp3",
    audioBitrate: "128",
  });
});

test("saves youtube audio as tagged ogg opus", async ({ page, upstreams }) => {
  const video = await upstreams.youtube.video({ title: "Low Sun", author: "Field Notes" });
  const save = saveApp(page);
  const filename = "Low Sun - Field Notes (youtube).opus";

  await save.open();
  await save.configure({ mode: "audio", audio: "opus" });
  await save.save(video.url, filename);

  const file = await save.download(filename);
  const { format, metadata } = await inspectAudio(file);
  expect(format).toBe("opus");
  expect(metadata).toMatchObject({ title: "Low Sun", artist: "Field Notes" });
  const media = await probeMedia(file);
  expect(media.container).toBe("ogg");
  expect(media.streams).toEqual([expect.objectContaining({ type: "audio", codec: "opus" })]);
  expect(media.streams[0]!.frames).toBeGreaterThan(0);
});

test("source audio is saved in the container its name promises, with tags", async ({
  page,
  upstreams,
}) => {
  const webm = await upstreams.youtube.video({
    title: "Open Water",
    author: "Drift",
    video: ["h264-1080", "vp9-720"],
  });
  const m4a = await upstreams.youtube.video({ title: "Closed Room", author: "Drift" });
  const save = saveApp(page);

  await save.open();
  await save.configure({ mode: "audio" });
  await save.save(webm.url, "Open Water - Drift (youtube).opus");
  const opus = await save.download("Open Water - Drift (youtube).opus");
  expect(await inspectAudio(opus)).toMatchObject({
    format: "opus",
    metadata: { title: "Open Water", artist: "Drift" },
  });
  const opusMedia = await probeMedia(opus);
  expect(opusMedia.container).toBe("ogg");
  expect(opusMedia.streams[0]).toMatchObject({ type: "audio", codec: "opus" });
  expect(opusMedia.streams[0]!.frames).toBeGreaterThan(0);

  await save.save(m4a.url, "Closed Room - Drift (youtube).m4a");
  const aac = await save.download("Closed Room - Drift (youtube).m4a");
  const { format, metadata } = await inspectAudio(aac);
  expect(format).toBe("m4a");
  expect(metadata).toMatchObject({ title: "Closed Room", artist: "Drift" });
  expect(metadata.picture).toHaveLength(1);

  const requests = (await upstreams.calls({ route: "cobalt.resolve" })).map((call) =>
    JSON.parse(call.requestBody!),
  );
  expect(requests.map((body) => [body.downloadMode, body.audioFormat])).toEqual([
    ["audio", "best"],
    ["audio", "best"],
  ]);
});

test("saves soundcloud audio with its provider tags in each audio format", async ({
  page,
  upstreams,
}) => {
  journey();
  const track = await upstreams.soundcloud.track({
    title: "Monkeys Spinning",
    author: "Kevin",
    album: "Loops",
    genre: "pizzicato",
    year: 2014,
  });
  const save = saveApp(page);
  const tags = {
    title: "Monkeys Spinning",
    artist: "Kevin",
    albumArtist: "Kevin",
    album: "Loops",
    genre: "pizzicato",
    year: 2014,
  };

  await save.open();
  await save.save(track.url, "Monkeys Spinning - Kevin (soundcloud).opus");
  await expect(save.rows.locator("img[data-save-download-cover-state=loaded]")).toHaveCount(1);
  const source = await save.download("Monkeys Spinning - Kevin (soundcloud).opus");
  expect(await inspectAudio(source)).toMatchObject({ format: "opus", metadata: tags });
  await expectLosslessAudio(source, audioFixture("opus").file);

  await save.configure({ mode: "audio", audio: "mp3" });
  await save.save(track.url, "Monkeys Spinning - Kevin (soundcloud).mp3");
  const mp3 = await save.download("Monkeys Spinning - Kevin (soundcloud).mp3");
  const encoded = await inspectAudio(mp3);
  expect(encoded).toMatchObject({ format: "mp3", metadata: tags });
  expect(encoded.metadata.picture).toHaveLength(1);
  expect((await probeMedia(mp3)).streams).toContainEqual(
    expect.objectContaining({ type: "audio", codec: "mp3" }),
  );

  await save.configure({ audio: "opus" });
  await save.save(track.url, "Monkeys Spinning - Kevin (soundcloud).opus");
  await expect(save.downloadButton("Monkeys Spinning - Kevin (soundcloud).opus")).toHaveCount(2);
  const opus = await save.download("Monkeys Spinning - Kevin (soundcloud).opus", 0);
  expect(await inspectAudio(opus)).toMatchObject({ format: "opus", metadata: tags });
  expect((await probeMedia(opus)).container).toBe("ogg");

  const requests = (await upstreams.calls({ route: "cobalt.resolve" })).map((call) =>
    JSON.parse(call.requestBody!),
  );
  expect(requests.map((body) => [body.downloadMode, body.audioFormat])).toEqual([
    ["auto", "best"],
    ["audio", "mp3"],
    ["audio", "opus"],
  ]);
});
