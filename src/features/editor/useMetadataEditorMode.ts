import { useState } from "react";

export type MetadataEditorMode = "normal" | "advanced";

export const useMetadataEditorMode = (advancedMetadataEnabled: boolean) => {
  const [requestedMode, setRequestedMode] = useState<MetadataEditorMode>("normal");

  return {
    mode: advancedMetadataEnabled ? requestedMode : "normal",
    setMode: setRequestedMode,
  };
};
