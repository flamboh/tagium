import {
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props, children);
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => createElement("input", props),
}));

const preview = {
  kind: "album",
  title: "Night Drive",
  tracks: [{ key: "a:0", title: "Intro" }],
  cover: {
    format: "image/png",
    blob: new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
  },
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("share album dialog", () => {
  it("releases a retained cover object URL when the dialog closes", () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: { status: "confirm", preview },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(createObjectURL).toHaveBeenCalledWith(preview.cover.blob);

    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "closed" },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    act(() => renderer.unmount());
  });
});
