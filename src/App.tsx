import AudioTagger from "@/features/workspace/audioTagger";
import { DevPanel } from "@/components/dev/DevPanel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <AudioTagger />
      <DevPanel />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
