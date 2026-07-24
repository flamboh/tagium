import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import SettingsPage from "@/features/settings/SettingsPage";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import { getMetadataLinkDescriptor } from "@/features/library/metadataLinks";

describe("settings page advanced metadata controls", () => {
  it("shows descriptor-driven link controls and gates album artist by relevance", () => {
    const render = (advancedMetadata: boolean) =>
      renderToStaticMarkup(
        <SettingsPage
          settings={{ ...DEFAULT_APP_SETTINGS, advancedMetadata }}
          onChange={vi.fn()}
          onBack={vi.fn()}
        />,
      );

    const normalMarkup = render(false);
    const advancedMarkup = render(true);

    expect(normalMarkup).toContain("enable advanced metadata");
    expect(normalMarkup).not.toContain(getMetadataLinkDescriptor("albumArtist").label);
    expect(advancedMarkup).toContain(getMetadataLinkDescriptor("albumArtist").label);

    for (const id of ["artist", "year", "genre", "artwork"] as const) {
      expect(normalMarkup).toContain(getMetadataLinkDescriptor(id).label);
    }
  });
});
