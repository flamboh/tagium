import { useWatch, type Control } from "react-hook-form";
import type { AudioMetadata } from "@/features/library/types";

export const useLinkedAlbumArtistDisplay = (control: Control<AudioMetadata>) =>
  useWatch({ control, name: "artist", defaultValue: "" });
