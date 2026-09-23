import { useMemo, useState } from "react";
import { MusicNote04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

interface AlbumCoverThumbProps {
  picture?: { format: string; data: Uint8Array }[];
}

const toBase64 = (data: Uint8Array) => {
  let binary = "";

  for (let index = 0; index < data.length; index += 1) {
    binary += String.fromCharCode(data[index]);
  }

  return btoa(binary);
};

export function AlbumCoverThumb({ picture }: AlbumCoverThumbProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const pic = picture?.[0];
  const src = useMemo(() => {
    if (!pic) {
      return null;
    }

    return `data:${pic.format};base64,${toBase64(pic.data)}`;
  }, [pic]);

  return (
    <div className="relative w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
      <HugeiconsIcon
        icon={MusicNote04Icon}
        strokeWidth={2}
        className="h-4 w-4 text-muted-foreground"
      />
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          onLoad={() => setLoadedSrc(src)}
          className={cn(
            "absolute inset-0 w-9 h-9 rounded-md object-cover ring-1 ring-border/50 invisible scale-[0.97] transition-transform duration-150 ease-out motion-reduce:scale-100 motion-reduce:transition-none",
            loadedSrc === src ? "visible scale-100" : "",
          )}
        />
      )}
    </div>
  );
}
