import { describe, expect, it } from "vite-plus/test";
import sharedAlbumPageSource from "@/features/share/SharedAlbumPage.tsx?raw";
import shareDialogSource from "@/features/share/ShareAlbumDialog.tsx?raw";

describe("shared album copy and copy deck", () => {
  it("offers an accessible copy-link action when another Tagium tab is present", () => {
    expect(sharedAlbumPageSource).toContain("Tagium is open in another tab.");
    expect(sharedAlbumPageSource).toContain("copyShareLink");
    expect(sharedAlbumPageSource).toContain('aria-label="share link"');
    expect(sharedAlbumPageSource).toContain('role="status"');
    expect(sharedAlbumPageSource).toContain("Copy failed. Copy the selected link");
  });

  it("keeps preview explicit and its copy focused on sources, expiry, permission, and revocation", () => {
    expect(sharedAlbumPageSource).toContain(
      "onClick={alreadyAddedAlbumId ? onViewAlbum : () => onAdd()}",
    );
    expect(sharedAlbumPageSource).toContain(
      "Downloads use the original sources with the shared tags and cover.",
    );
    expect(shareDialogSource).toContain(
      "Recipients download from the original sources with your tags and cover.",
    );
    expect(shareDialogSource).toContain("Confirm you have permission to share these sources.");
    expect(shareDialogSource).toContain(
      "This share link expires in 90 days. Stop sharing to revoke it immediately.",
    );
    expect(shareDialogSource).not.toContain("Audio is not uploaded");
    expect(shareDialogSource).not.toContain("Anyone with this link can review");
  });
});
