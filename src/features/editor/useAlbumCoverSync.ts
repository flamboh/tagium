"use client";

import { useEffect, useRef, useState } from "react";

interface AlbumCoverSyncOptions {
  disabled: boolean;
  onSync?: () => Promise<void> | void;
}

export function useAlbumCoverSync({ disabled, onSync }: AlbumCoverSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [rotation, setRotation] = useState(0);
  const timerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const runRef = useRef(0);

  const cancel = (resetVisualState: boolean) => {
    runRef.current += 1;
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (resetVisualState) {
      setIsSyncing(false);
      setRotation(0);
    }
  };

  const start = () => {
    if (!onSync || isSyncing || disabled) return;

    const startedAt = performance.now();
    const syncRun = runRef.current + 1;
    runRef.current = syncRun;
    setRotation((currentRotation) => currentRotation + 360);
    setIsSyncing(true);
    const result = onSync();

    void Promise.resolve(result).finally(() => {
      if (runRef.current !== syncRun) return;
      const remaining = Math.max(0, 650 - (performance.now() - startedAt));
      timerRef.current = globalThis.setTimeout(() => {
        if (runRef.current !== syncRun) return;
        timerRef.current = null;
        setIsSyncing(false);
      }, remaining);
    });
  };

  useEffect(
    () => () => {
      cancel(false);
    },
    [],
  );

  return {
    cancel: () => cancel(true),
    isSyncing,
    label: isSyncing ? "syncing cover to tracks" : "sync cover to tracks",
    rotation,
    start,
  };
}
