import AudioTagger from "@/components/audio/audioTagger";
import MetadataCleanupPrototype from "@/components/prototypes/MetadataCleanupPrototype";
import { DevPanel } from "@/components/dev/DevPanel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  if (window.location.pathname.startsWith("/prototype/metadata-cleanup")) {
    return <MetadataCleanupPrototype />;
  }

  return (
    <TooltipProvider>
      <AudioTagger />
      <DevPanel />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
