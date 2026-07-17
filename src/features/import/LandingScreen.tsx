"use client";

import type { ReactNode } from "react";
import AudioImportDropzone from "@/features/import/AudioImportDropzone";

interface LandingScreenProps {
  active: boolean;
  children?: ReactNode;
  onAudioUpload: (files: File[]) => void | Promise<void>;
}

export default function LandingScreen({ active, children, onAudioUpload }: LandingScreenProps) {
  return (
    <div
      className={
        active
          ? "h-svh min-h-0 overflow-y-auto flex flex-col items-center justify-center p-8 max-lg:[@media(max-height:700px)]:p-4 md:h-auto md:flex-1"
          : "contents"
      }
    >
      <div
        className={
          active
            ? "flex w-full max-w-md flex-col items-center gap-10 max-lg:[@media(max-height:700px)]:gap-6"
            : "contents"
        }
      >
        {active && (
          <AudioImportDropzone
            showBrand
            onAudioUpload={onAudioUpload}
            className="animate-in fade-in motion-reduce:animate-none"
          />
        )}
        {children}
      </div>
    </div>
  );
}
