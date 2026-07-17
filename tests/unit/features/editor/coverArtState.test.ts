import { describe, expect, it } from "vite-plus/test";
import { coverArtReducer, initialCoverArtState } from "@/features/editor/coverArtState";

const cover = (name: string) => new File([name], name, { type: "image/jpeg" });

describe("cover art state", () => {
  it("commits a successful upload as one cohesive transition", () => {
    const previousCover = cover("previous.jpg");
    const cropSource = { url: "blob:crop", owned: true };
    const editing = {
      ...initialCoverArtState,
      uploadedCover: previousCover,
      cropSource,
      isCropperOpen: true,
      error: "previous error",
      isErrorOpen: true,
    };

    const processing = coverArtReducer(editing, {
      type: "uploadStarted",
      uploadId: 4,
      closeCropper: true,
    });
    expect(processing).toMatchObject({
      activeUploadId: 4,
      uploadedCover: previousCover,
      cropSource: null,
      isCropperOpen: false,
      isProcessing: true,
      error: "previous error",
      isErrorOpen: true,
    });

    const uploadedCover = cover("latest.jpg");
    expect(
      coverArtReducer(processing, { type: "uploadSucceeded", uploadId: 4, file: uploadedCover }),
    ).toMatchObject({
      activeUploadId: 4,
      uploadedCover,
      isProcessing: false,
      error: null,
      isErrorOpen: false,
    });
  });

  it("keeps the previous cover and exposes a current upload error", () => {
    const uploadedCover = cover("previous.jpg");
    const processing = coverArtReducer(
      { ...initialCoverArtState, uploadedCover },
      { type: "uploadStarted", uploadId: 2 },
    );

    expect(
      coverArtReducer(processing, {
        type: "uploadFailed",
        uploadId: 2,
        message: "could not optimize cover art.",
      }),
    ).toMatchObject({
      uploadedCover,
      isProcessing: false,
      error: "could not optimize cover art.",
      isErrorOpen: true,
    });
  });

  it("ignores stale success and error completions after a newer upload starts", () => {
    const latest = coverArtReducer(initialCoverArtState, {
      type: "uploadStarted",
      uploadId: 8,
    });

    expect(
      coverArtReducer(latest, {
        type: "uploadSucceeded",
        uploadId: 7,
        file: cover("stale.jpg"),
      }),
    ).toBe(latest);
    expect(
      coverArtReducer(latest, { type: "uploadFailed", uploadId: 7, message: "stale error" }),
    ).toBe(latest);
  });

  it("opens and closes the crop resource as one editing transition", () => {
    const source = { url: "blob:crop", owned: true };
    const open = coverArtReducer(initialCoverArtState, { type: "cropOpened", source });

    expect(open).toMatchObject({ cropSource: source, isCropperOpen: true });
    expect(coverArtReducer(open, { type: "cropClosed" })).toMatchObject({
      cropSource: null,
      isCropperOpen: false,
    });
  });

  it("closes the error tooltip without clearing the validation error", () => {
    const failed = {
      ...initialCoverArtState,
      error: "bad image",
      isErrorOpen: true,
    };

    expect(coverArtReducer(failed, { type: "errorOpenChanged", open: false })).toMatchObject({
      error: "bad image",
      isErrorOpen: false,
    });
  });

  it("resets every editing surface while invalidating pending uploads", () => {
    const editing = {
      ...initialCoverArtState,
      activeUploadId: 3,
      uploadedCover: cover("uploaded.jpg"),
      cropSource: { url: "blob:crop", owned: true },
      isCropperOpen: true,
      isProcessing: true,
      error: "bad image",
      isErrorOpen: true,
    };

    expect(coverArtReducer(editing, { type: "reset", uploadId: 4 })).toEqual({
      ...initialCoverArtState,
      activeUploadId: 4,
    });
  });
});
