import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import AudioImportDropzone from "@/features/import/AudioImportDropzone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe("AudioImportDropzone", () => {
  it("forwards picked and dropped files and resets the reusable file input", () => {
    const onAudioUpload = vi.fn();
    const pickedFile = new File(["picked"], "picked.flac", { type: "audio/flac" });
    const droppedFile = new File(["dropped"], "dropped.m4a", { type: "audio/mp4" });
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<AudioImportDropzone onAudioUpload={onAudioUpload} />);
    });
    const input = renderer!.root.findByType("input");
    const button = renderer!.root.findByType("button");
    const inputTarget = { files: [pickedFile], value: "picked.flac" };

    act(() => {
      input.props.onChange({ target: inputTarget });
      button.props.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [droppedFile] },
      });
    });

    expect(onAudioUpload).toHaveBeenNthCalledWith(1, [pickedFile]);
    expect(onAudioUpload).toHaveBeenNthCalledWith(2, [droppedFile]);
    expect(inputTarget.value).toBe("");
    act(() => renderer!.unmount());
  });

  it("keeps the drag state active until nested drag leaves are balanced", () => {
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<AudioImportDropzone onAudioUpload={vi.fn()} />);
    });
    const button = renderer!.root.findByType("button");
    const dragEvent = { preventDefault: vi.fn() };

    act(() => {
      button.props.onDragEnter(dragEvent);
      button.props.onDragEnter(dragEvent);
      button.props.onDragLeave(dragEvent);
    });
    expect(renderer!.root.findAllByProps({ children: "drop to import" })).toHaveLength(1);

    act(() => {
      button.props.onDragLeave(dragEvent);
    });
    expect(renderer!.root.findAllByProps({ children: "drop your audio here" })).toHaveLength(1);
    act(() => renderer!.unmount());
  });

  it("installs global cancellation cleanup only while an external drag is active", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const addWindowListener = vi.spyOn(windowTarget, "addEventListener");
    const removeWindowListener = vi.spyOn(windowTarget, "removeEventListener");
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<AudioImportDropzone onAudioUpload={vi.fn()} />);
    });
    const button = renderer!.root.findByType("button");
    expect(addWindowListener).not.toHaveBeenCalled();

    act(() => {
      button.props.onDragEnter({ preventDefault: vi.fn() });
    });
    expect(addWindowListener).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(renderer!.root.findAllByProps({ children: "drop to import" })).toHaveLength(1);

    act(() => {
      windowTarget.dispatchEvent(new Event("blur"));
    });
    expect(renderer!.root.findAllByProps({ children: "drop your audio here" })).toHaveLength(1);
    expect(removeWindowListener).toHaveBeenCalledWith("blur", expect.any(Function));

    act(() => {
      button.props.onDragEnter({ preventDefault: vi.fn() });
    });
    act(() => {
      documentTarget.dispatchEvent(new Event("dragleave"));
    });
    expect(renderer!.root.findAllByProps({ children: "drop your audio here" })).toHaveLength(1);
    act(() => renderer!.unmount());
  });
});
