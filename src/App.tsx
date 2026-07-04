import AudioTagger from "@/components/audio/audioTagger";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <AudioTagger />
    </TooltipProvider>
  );
}
