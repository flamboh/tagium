import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { getMetadataLinkDescriptor } from "@/features/library/metadataLinks";
import SettingsPage from "@/features/settings/SettingsPage";
import { LinkingSettingsSection } from "@/features/settings/SettingsSections";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

describe("settings page advanced metadata controls", () => {
  it("shows descriptor-driven link controls and gates album artist by relevance", () => {
    const render = (advancedMetadata: boolean) =>
      renderToStaticMarkup(
        <LinkingSettingsSection
          settings={{ ...DEFAULT_APP_SETTINGS, advancedMetadata }}
          onChange={vi.fn()}
        />,
      );

    const normalMarkup = render(false);
    const advancedMarkup = render(true);

    expect(normalMarkup).not.toContain(getMetadataLinkDescriptor("albumArtist").label);
    expect(advancedMarkup).toContain(getMetadataLinkDescriptor("albumArtist").label);

    for (const id of [
      "artist",
      "year",
      "genre",
      "artwork",
      "trackNumber",
      "filename",
      "singleAlbum",
    ] as const) {
      expect(normalMarkup).toContain(getMetadataLinkDescriptor(id).label);
    }
  });

  it("switches panels and updates descriptor-driven link switches", async () => {
    const onChange = vi.fn();
    const onBack = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <SettingsPage settings={DEFAULT_APP_SETTINGS} onChange={onChange} onBack={onBack} />,
      );
    });

    const sectionButton = (id: string) =>
      renderer.root.findByProps({ id: `settings-section-${id}` });
    const headings = () => renderer.root.findAllByType("h3").map((heading) => heading.children[0]);
    const expectCurrentSection = (id: string) => {
      const currentButtons = renderer.root.findAllByProps({ "aria-current": "page" });

      expect(currentButtons).toHaveLength(1);
      expect(currentButtons[0]?.props.id).toBe(`settings-section-${id}`);
      expect(renderer.root.findByProps({ role: "region" }).props["aria-labelledby"]).toBe(
        `settings-section-${id}`,
      );
    };

    expectCurrentSection("importing");
    expect(headings()).toContain("importing");
    expect(headings()).not.toContain("editing");
    expect(renderer.root.findByProps({ "aria-label": "back to workspace" })).toBeDefined();

    await act(() => sectionButton("editing").props.onClick());
    expectCurrentSection("editing");
    expect(headings()).toContain("editing");
    expect(headings()).not.toContain("importing");

    await act(() => sectionButton("linking").props.onClick());
    expectCurrentSection("linking");
    const filenameLabel = getMetadataLinkDescriptor("filename").label;
    const filenameSwitch = () =>
      renderer.root.findByProps({ role: "switch", "aria-label": filenameLabel });

    expect(filenameSwitch().props["aria-checked"]).toBe(true);
    await act(() => filenameSwitch().props.onClick());
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APP_SETTINGS, syncFilenames: false });

    act(() => {
      renderer.update(
        <SettingsPage
          settings={{ ...DEFAULT_APP_SETTINGS, syncFilenames: false }}
          onChange={onChange}
          onBack={onBack}
        />,
      );
    });
    expect(filenameSwitch().props["aria-checked"]).toBe(false);
  });
});
