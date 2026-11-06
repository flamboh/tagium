import { lazy, Suspense, useLayoutEffect } from "react";
import { useLocale } from "gt-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocaleRevision } from "@/i18n/initializeI18n";
import type { TagiumAppId } from "@/runtime/resolveApp";

const TagiumApp = lazy(() => import("@/apps/tagium/TagiumApp"));

const TagiumSaveApp = lazy(() => import("@/apps/tagium-save/TagiumSaveApp"));

export default function AppRoot({ appId }: { appId: TagiumAppId }) {
  useLocaleRevision();
  const locale = useLocale();

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
