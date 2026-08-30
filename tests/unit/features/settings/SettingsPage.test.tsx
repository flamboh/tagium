import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { getMetadataLinkDescriptor } from "@/features/library/metadataLinks";
import SettingsPage from "@/features/settings/SettingsPage";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

describe("settings page", () => {
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
    const expectCurrentSection = (id: string) => {
      const currentButtons = renderer.root.findAllByProps({ "aria-current": "page" });

      expect(currentButtons).toHaveLength(1);
      expect(currentButtons[0]?.props.id).toBe(`settings-section-${id}`);
    };

    expectCurrentSection("importing");

    await act(() => sectionButton("editing").props.onClick());
    expectCurrentSection("editing");

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
