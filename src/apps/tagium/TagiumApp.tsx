import { DevPanel } from "@/components/dev/DevPanel";
import AudioTagger from "@/features/workspace/audioTagger";

export default function TagiumApp() {
  return (
    <>
      <AudioTagger />
      <DevPanel />
    </>
  );
}
