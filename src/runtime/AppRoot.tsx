import { lazy, Suspense, useLayoutEffect } from "react";
import { useGT } from "gt-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDisplayedLocale } from "@/i18n/i18n";
import type { TagiumAppId } from "@/runtime/resolveApp";

const TagiumApp = lazy(() => import("@/apps/tagium/TagiumApp"));

const TagiumSaveApp = lazy(() => import("@/apps/tagium-save/TagiumSaveApp"));

export default function AppRoot({ appId }: { appId: TagiumAppId }) {
  const gt = useGT();
  const locale = useDisplayedLocale();

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <TooltipProvider>
      <Suspense fallback={null}>
        {appId === "tagium-save" ? <TagiumSaveApp /> : <TagiumApp />}
      </Suspense>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        customAriaLabel={gt("notifications, alt+t")}
        toastOptions={{ closeButtonAriaLabel: gt("close notification") }}
      />
    </TooltipProvider>
  );
}
