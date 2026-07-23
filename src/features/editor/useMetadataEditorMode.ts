import { useState } from "react";

export type MetadataEditorMode = "normal" | "advanced";

export const useMetadataEditorMode = (advancedMetadataEnabled: boolean) => {
  const [mode, setMode] = useState<MetadataEditorMode>("normal");

  return {
    mode: advancedMetadataEnabled ? mode : "normal",
    setMode,
  };
};
