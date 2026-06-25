import { useMemo } from "react";
import { Music2 } from "lucide-react";

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
  const pic = picture?.[0];
  const src = useMemo(() => {
    if (!pic) {
      return null;
    }

    return `data:${pic.format};base64,${toBase64(pic.data)}`;
  }, [pic]);

  if (!src) {
    return (
      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
        <Music2 className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="w-9 h-9 rounded-md object-cover flex-shrink-0 ring-1 ring-border/50"
    />
  );
}
