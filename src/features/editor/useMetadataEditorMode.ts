import { useState } from "react";

export type MetadataEditorMode = "normal" | "advanced";

export const useMetadataEditorMode = (advancedMetadataEnabled: boolean) => {
  const [mode, setMode] = useState<MetadataEditorMode>("normal");
  const [previouslyEnabled, setPreviouslyEnabled] = useState(advancedMetadataEnabled);

  if (previouslyEnabled !== advancedMetadataEnabled) {
    setPreviouslyEnabled(advancedMetadataEnabled);
    if (!advancedMetadataEnabled && mode !== "normal") setMode("normal");
  }

  return {
    mode: advancedMetadataEnabled ? mode : "normal",
    setMode,
  };
};
