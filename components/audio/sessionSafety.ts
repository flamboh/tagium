import { useEffect } from "react";

export interface RecoverableSessionState {
  fileCount: number;
  albumCount: number;
  importing: boolean;
}

export const hasRecoverableSessionWork = ({
  fileCount,
  albumCount,
  importing,
}: RecoverableSessionState) => fileCount > 0 || albumCount > 0 || importing;

export const useBeforeUnloadProtection = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;

    const protectSession = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", protectSession);
    return () => window.removeEventListener("beforeunload", protectSession);
  }, [enabled]);
};
