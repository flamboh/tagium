export const isTrackPreviewActive = ({
  activeView,
  isMobile,
  drawerOpen,
}: {
  activeView: "editor" | "settings";
  isMobile: boolean;
  drawerOpen: boolean;
}) => activeView === "editor" && (!isMobile || !drawerOpen);
