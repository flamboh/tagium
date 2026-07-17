import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import SettingsPage from "@/features/settings/SettingsPage";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import {
  METADATA_LINK_DESCRIPTORS,
  METADATA_LINK_SETTINGS_DESCRIPTORS,
  isMetadataLinkVisible,
} from "@/features/library/metadataLinks";

const renderSettings = (advancedMetadata = false) =>
  renderToStaticMarkup(
    <SettingsPage
      settings={{ ...DEFAULT_APP_SETTINGS, advancedMetadata }}
      onChange={vi.fn()}
      onBack={vi.fn()}
    />,
  );

describe("settings page", () => {
  it("orders common settings before progressive metadata linking", () => {
    const markup = renderSettings();
    const headings = ["general", "metadata", "downloads", "about", "ethics", "acknowledgements"];
    const headingPositions = headings.map((heading) => markup.indexOf(`>${heading}</h3>`));

    for (const heading of headings) expect(markup).toContain(`>${heading}</h3>`);
    expect(headingPositions).toEqual(headingPositions.toSorted((a, b) => a - b));
    expect(markup).toContain("<details");
    expect(markup).toContain("advanced linking");
    expect(markup).toContain("select-none");
  });

  it("shows the album artist link only when advanced metadata is enabled", () => {
    expect(renderSettings()).not.toContain("link album artist to track artist");
    expect(renderSettings(true)).toContain("link album artist to track artist");
  });

  it("always exposes all normal metadata link controls", () => {
    const markup = renderSettings();

    for (const descriptor of METADATA_LINK_SETTINGS_DESCRIPTORS.filter((candidate) =>
      isMetadataLinkVisible(candidate, DEFAULT_APP_SETTINGS),
    )) {
      expect(markup).toContain(descriptor.label);
      expect(markup).toContain(descriptor.relation);
    }
    expect(markup).toContain("album title always follows the album and cannot be unlinked");
  });

  it("shows track-number syncing once in General, not in advanced linking", () => {
    const markup = renderSettings();

    expect(markup.match(/use album sidebar order as track number/g)).toHaveLength(1);
    expect(markup).not.toContain("link track number to album order");
    expect(METADATA_LINK_SETTINGS_DESCRIPTORS.map(({ id }) => id)).not.toContain("trackNumber");
  });

  it("defines relation, reason, and private boolean analytics for every link", () => {
    expect(new Set(METADATA_LINK_DESCRIPTORS.map(({ id }) => id)).size).toBe(6);
    for (const descriptor of METADATA_LINK_DESCRIPTORS) {
      expect(descriptor.relation.length).toBeGreaterThan(0);
      expect(descriptor.disabledReason.length).toBeGreaterThan(0);
      expect(descriptor.analyticsProperty).toMatch(/^(link_|sync_track_numbers)/);
    }
  });
});
