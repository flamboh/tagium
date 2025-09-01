import AudioTagger from "@/components/audio/audioTagger";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <h1 className="text-4xl font-bold">tagium</h1>
      <AudioTagger />
    </div>
  );
}
