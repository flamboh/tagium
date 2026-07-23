import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import AudioImportDropzone from "@/features/import/AudioImportDropzone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AudioImportDropzone", () => {
  it("forwards picked and dropped files through the shared import callback", () => {
    const onAudioUpload = vi.fn();
    const pickedFile = new File(["picked"], "picked.mp3", { type: "audio/mpeg" });
    const droppedFile = new File(["dropped"], "dropped.mp3", { type: "audio/mpeg" });
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<AudioImportDropzone onAudioUpload={onAudioUpload} />);
    });
    const input = renderer!.root.findByType("input");
    const button = renderer!.root.findByType("button");

    act(() => {
      input.props.onChange({ target: { files: [pickedFile], value: "picked.mp3" } });
      button.props.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [droppedFile] },
      });
    });

    expect(onAudioUpload).toHaveBeenNthCalledWith(1, [pickedFile]);
    expect(onAudioUpload).toHaveBeenNthCalledWith(2, [droppedFile]);
    act(() => renderer!.unmount());
  });

  it("only shows the product title on the landing variant", () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AudioImportDropzone onAudioUpload={vi.fn()} />);
    });
    expect(renderer!.root.findAllByType("h1")).toHaveLength(0);

    act(() => {
      renderer!.update(<AudioImportDropzone showBrand onAudioUpload={vi.fn()} />);
    });
    expect(renderer!.root.findByType("h1").children).toEqual(["tagium"]);
    act(() => renderer!.unmount());
  });
});
