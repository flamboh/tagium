import { lazy, Suspense, useLayoutEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDisplayedLocale } from "@/i18n/i18n";
import type { TagiumAppId } from "@/runtime/resolveApp";

const TagiumApp = lazy(() => import("@/apps/tagium/TagiumApp"));

const TagiumSaveApp = lazy(() => import("@/apps/tagium-save/TagiumSaveApp"));

export default function AppRoot({ appId }: { appId: TagiumAppId }) {
  const locale = useDisplayedLocale();

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <TooltipProvider>
      <Suspense fallback={null}>
        {appId === "tagium-save" ? <TagiumSaveApp /> : <TagiumApp />}
      </Suspense>
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
