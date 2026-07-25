export type MediaUrlEntryLayout = "landing" | "empty-editor" | "editor";

export interface MediaUrlEntryPresentation {
  layout: MediaUrlEntryLayout;
}

export const getMediaUrlEntryPresentation = (
  libraryIsEmpty: boolean,
  settingsOpen: boolean,
  trackSelected = false,
): MediaUrlEntryPresentation | null => {
  if (settingsOpen) return null;
  if (libraryIsEmpty) return { layout: "landing" };
  return { layout: trackSelected ? "editor" : "empty-editor" };
};
