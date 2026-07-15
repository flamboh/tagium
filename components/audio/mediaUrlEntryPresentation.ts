export type MediaUrlEntryLayout = "landing" | "editor";

interface MediaUrlEntryPresentation {
  layout: MediaUrlEntryLayout;
  hidden: boolean;
  docked: boolean;
}

export const getMediaUrlEntryPresentation = (
  libraryIsEmpty: boolean,
  settingsOpen: boolean,
): MediaUrlEntryPresentation => ({
  layout: libraryIsEmpty && !settingsOpen ? "landing" : "editor",
  hidden: settingsOpen && !libraryIsEmpty,
  docked: libraryIsEmpty && settingsOpen,
});
