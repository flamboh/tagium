import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionProvider } from "@/runtime/MotionProvider";
import type { TagiumAppId } from "@/runtime/resolveApp";

const TagiumApp = lazy(() => import("@/apps/tagium/TagiumApp"));
const TagiumSaveApp = lazy(() => import("@/apps/tagium-save/TagiumSaveApp"));

export default function AppRoot({ appId }: { appId: TagiumAppId }) {
  return (
    <MotionProvider>
      <TooltipProvider>
        <Suspense fallback={null}>
          {appId === "tagium-save" ? <TagiumSaveApp /> : <TagiumApp />}
        </Suspense>
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </MotionProvider>
  );
}
