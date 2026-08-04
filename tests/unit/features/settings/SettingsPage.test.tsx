import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import SettingsPage from "@/features/settings/SettingsPage";
import { MetadataSettingsSection } from "@/features/settings/SettingsPageSections";
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

    expect(normalMarkup).toContain('aria-label="back to workspace"');
    expect(normalMarkup).toContain("enable advanced metadata");
    expect(normalMarkup).not.toContain(getMetadataLinkDescriptor("albumArtist").label);
    expect(advancedMarkup).toContain(getMetadataLinkDescriptor("albumArtist").label);

    for (const id of ["artist", "year", "genre", "artwork"] as const) {
      expect(normalMarkup).toContain(getMetadataLinkDescriptor(id).label);
    }
    for (const removedSubtitle of [
      "artist follows the album artist",
      "year follows the album year",
      "genre follows the album genre",
      "artwork follows the album cover",
    ]) {
      expect(normalMarkup).not.toContain(removedSubtitle);
    }
    expect(normalMarkup).not.toContain("linked tags follow album changes");
    expect(normalMarkup).not.toContain("album title always follows the album");
  });

  it("transitions the metadata linking disclosure while keeping its controls inaccessible closed", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <MetadataSettingsSection settings={DEFAULT_APP_SETTINGS} onChange={vi.fn()} />,
      );
    });

    const trigger = () =>
      renderer.root.findAllByType("button").find((button) => button.props["aria-controls"]);
    const content = () => renderer.root.findByProps({ "data-metadata-linking-content": true });

    expect(trigger()?.props["aria-expanded"]).toBe(false);
    expect(content().props["aria-hidden"]).toBe(true);
    expect(content().props.inert).toBe(true);
    expect(content().props.className).toContain("transition-[grid-template-rows,opacity]");

    await act(() => trigger()?.props.onClick());
    expect(trigger()?.props["aria-expanded"]).toBe(true);
    expect(content().props["aria-hidden"]).toBe(false);
  });
});
