import { useEffect, useState } from "react";

export type MetadataEditorMode = "normal" | "advanced";

export const useMetadataEditorMode = (advancedMetadataEnabled: boolean) => {
  const [mode, setMode] = useState<MetadataEditorMode>("normal");

  useEffect(() => {
    if (!advancedMetadataEnabled) setMode("normal");
  }, [advancedMetadataEnabled]);

  return { mode, setMode };
};
