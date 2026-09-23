import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useMediaUrlEntryController } from "@/features/import/useMediaUrlEntryController";
import MediaUrlEntry from "@/shared/media-url/MediaUrlEntry";

const reportSystemFailure = vi.hoisted(() => vi.fn());

vi.mock("@/shared/systemFailure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/systemFailure")>();
  return { ...actual, reportSystemFailure };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function MediaUrlEntryHarness({
  layout,
  onUrlImport,
}: {
  layout: "landing" | "editor";
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
}) {
  const controller = useMediaUrlEntryController(onUrlImport);
  return <MediaUrlEntry layout={layout} controller={controller} />;
}

afterEach(() => vi.clearAllMocks());

describe("media URL entry", () => {
  it("submits a trimmed valid URL", async () => {
    const onUrlImport = vi.fn(async () => undefined);
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<MediaUrlEntryHarness layout="landing" onUrlImport={onUrlImport} />);
    });
    const input = renderer!.root.findByProps({ name: "media-url" });
    await act(async () => {
      input.props.onChange({ target: { value: "  https://soundcloud.com/user/track  " } });
    });
    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onUrlImport).toHaveBeenCalledWith("https://soundcloud.com/user/track");
    act(() => renderer!.unmount());
  });

  it("keeps malformed URL feedback local to the input", async () => {
    const onUrlImport = vi.fn();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<MediaUrlEntryHarness layout="landing" onUrlImport={onUrlImport} />);
    });
    const input = renderer!.root.findByProps({ name: "media-url" });
    await act(async () => {
      input.props.onChange({ target: { value: "not a url" } });
    });
    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(renderer!.root.findByProps({ id: "media-url-error" }).children).toEqual([
      "enter a complete http or https url",
    ]);
    expect(onUrlImport).not.toHaveBeenCalled();
    expect(reportSystemFailure).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("routes rejected system work through the shared reporter without local field copy", async () => {
    const failure = new Error("private upstream detail");
    const onUrlImport = vi.fn(async () => {
      throw failure;
    });
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<MediaUrlEntryHarness layout="editor" onUrlImport={onUrlImport} />);
    });
    const input = renderer!.root.findByProps({ name: "media-url" });
    await act(async () => {
      input.props.onChange({ target: { value: "https://youtube.com/watch?v=abc" } });
    });
    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(reportSystemFailure).toHaveBeenCalledWith(failure, "import");
    expect(renderer!.root.findByProps({ id: "media-url-error" }).children).toHaveLength(0);
    act(() => renderer!.unmount());
  });

  it("keeps a pre-queue unavailable-link rejection beside the submitted URL", async () => {
    const onUrlImport = vi.fn(async () => {
      throw new Error("soundcloud set request failed (404)");
    });
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(<MediaUrlEntryHarness layout="landing" onUrlImport={onUrlImport} />);
    });
    const input = renderer!.root.findByProps({ name: "media-url" });
    await act(async () => {
      input.props.onChange({ target: { value: "https://soundcloud.com/user/sets/missing" } });
    });
    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(renderer!.root.findByProps({ id: "media-url-error" }).children).toEqual([
      "check that the link is public and still available, then try again",
    ]);
    expect(reportSystemFailure).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });
});
