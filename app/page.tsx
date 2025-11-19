import AudioTagger from "@/components/audio/audioTagger";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 bg-background p-8">
      <h1 className="text-4xl font-bold text-foreground">tagium</h1>
      <AudioTagger />
    </div>
  );
}
