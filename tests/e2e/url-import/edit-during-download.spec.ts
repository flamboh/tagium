import type { Page } from "@playwright/test";
import { captureDownload, inspectAudio } from "../support/audio";
import { downloadNames, expect, IMPORT_TIMEOUT, test } from "../support/test";
import { downloadTrackButton, importUrl } from "./helpers";

const holdTunnelResponse = async (page: Page) => {
  let received = false;
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/cobalt/tunnel?**", async (route) => {
    const response = await route.fetch();
    received = true;
    await gate;
    await route.fulfill({ response });
  });

  return { received: () => received, release };
};

for (const source of ["single", "playlist"] as const) {
  test(`youtube ${source} keeps edits made while its audio download is held`, async ({
    page,
    upstreams,
  }) => {
    const provider = { title: "Provider Song", author: "Provider Artist", year: 2015 };

    const imported =
      source === "single"
        ? await upstreams.youtube.video(provider)
        : await upstreams.youtube.playlist({
            title: "Provider Album",
            author: provider.author,
            videos: [provider],
          });

    const tunnel = await holdTunnelResponse(page);
    const field = (name: string) => page.getByLabel(name, { exact: true });

    const edits = {
      title: "Edited Song",
      filename: "custom-name",
      artist: "Edited Artist",
      year: "2024",
    };

    try {
      await page.goto("/");
      await importUrl(page, imported.url);
      await expect(field("title")).toHaveValue(provider.title);
      await expect.poll(tunnel.received).toBe(true);
      await expect(downloadTrackButton(page)).toBeDisabled();
      expect(await upstreams.calls({ route: "cobalt.tunnel.audio" })).toHaveLength(1);

      await page.getByRole("button", { name: "settings", exact: true }).click();
      await page
        .getByRole("navigation", { name: "settings sections" })
        .getByRole("button", { name: "linking", exact: true })
        .click();

      for (const name of [
        "sync filename with the track title",
        "sync artist with the album artist",
        "sync year with the album year",
      ]) {
        const link = page.getByRole("switch", { name, exact: true });
        await link.click();
        await expect(link).toHaveAttribute("aria-checked", "false");
      }

      await page.getByRole("button", { name: "back to workspace" }).click();

      await field("artist").fill(edits.artist);
      await field("year").fill(edits.year);
      await field("filename").fill(edits.filename);
      await field("title").fill(edits.title);

      for (const [name, value] of Object.entries(edits)) {
        await expect(field(name)).toHaveValue(value);
      }

      await expect(downloadTrackButton(page)).toBeDisabled();

      tunnel.release();
      await expect(downloadTrackButton(page)).toBeEnabled(IMPORT_TIMEOUT);

      for (const [name, value] of Object.entries(edits)) {
        await expect.soft(field(name)).toHaveValue(value);
      }

      const exported = await captureDownload(page, () => downloadTrackButton(page).click());
      expect.soft(downloadNames("custom-name.mp3")).toContain(exported.filename);
      expect.soft((await inspectAudio(exported)).metadata).toMatchObject({
        title: "Edited Song",
        artist: "Edited Artist",
        year: 2024,
      });

      for (const [name, value] of Object.entries(edits)) {
        await expect.soft(field(name)).toHaveValue(value);
      }

      await expect
        .soft(page.getByRole("button", { name: "track actions for custom-name.mp3" }))
        .toBeVisible();
    } finally {
      tunnel.release();
    }
  });
}
