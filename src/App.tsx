import AudioTagger from "@/components/audio/audioTagger";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <AudioTagger />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
