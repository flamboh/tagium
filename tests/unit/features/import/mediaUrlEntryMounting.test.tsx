import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import MediaUrlEntry, { useMediaUrlEntryController } from "@/features/import/MediaUrlEntry";
import { InvalidShareLinkError } from "@/features/share/shareLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function MediaEntryHarness({
  settingsOpen,
  onUrlImport,
}: {
  settingsOpen: boolean;
  onUrlImport: (sourceUrl: string) => Promise<void>;
}) {
  const controller = useMediaUrlEntryController(onUrlImport);
  if (settingsOpen) return <div data-view="settings" />;
  return <MediaUrlEntry layout="landing" controller={controller} onUrlImport={onUrlImport} />;
}

describe("media URL entry mounting", () => {
  it("is absent in settings and restores the entered share link and its error", async () => {
    const shareLink = "https://tagium.app/share/not-a-valid-slug";
    const onUrlImport = vi.fn(async () => {
      throw new InvalidShareLinkError();
    });
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<MediaEntryHarness settingsOpen={false} onUrlImport={onUrlImport} />);
    });
    const input = renderer!.root.findByProps({ name: "media-url" });

    await act(async () => {
      input.props.onChange({ target: { value: shareLink } });
    });
    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(renderer!.root.findByProps({ id: "media-url-error" }).children).toEqual([
      "that isn’t a tagium share link",
    ]);

    await act(async () => {
      renderer!.update(<MediaEntryHarness settingsOpen onUrlImport={onUrlImport} />);
    });
    expect(renderer!.root.findAllByProps({ name: "media-url" })).toHaveLength(0);

    await act(async () => {
      renderer!.update(<MediaEntryHarness settingsOpen={false} onUrlImport={onUrlImport} />);
    });
    expect(renderer!.root.findByProps({ name: "media-url" }).props.value).toBe(shareLink);
    expect(renderer!.root.findByProps({ id: "media-url-error" }).children).toEqual([
      "that isn’t a tagium share link",
    ]);
    act(() => renderer!.unmount());
  });
});
