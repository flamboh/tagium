"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { Input } from "../ui/input";
import { AudioMetadata } from "./audioTagger";

export default function TagForm({ metadata }: { metadata: AudioMetadata }) {
  return (
    <div className="flex-1 grid grid-cols-1 gap-3">
      <div>
        <label className="block text-sm font-medium mb-1">title:</label>
        <Input defaultValue={metadata.title || ""} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">artist:</label>
        <Input defaultValue={metadata.artist || ""} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">album:</label>
        <Input defaultValue={metadata.album || ""} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">year:</label>
        <Input defaultValue={metadata.year.toString() || ""} type="number" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">genre:</label>
        <Input
          defaultValue={
            metadata.genre
              ? Array.isArray(metadata.genre)
                ? metadata.genre.join(", ")
                : metadata.genre
              : ""
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">track:</label>
          <Input
            defaultValue={metadata.trackNumber.toString() || ""}
            type="number"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">of</label>
          <Input
            defaultValue={metadata.trackTotal.toString() || ""}
            type="number"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">disc:</label>
          <Input
            defaultValue={metadata.discNumber.toString() || ""}
            type="number"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">of</label>
          <Input
            defaultValue={metadata.discTotal.toString() || ""}
            type="number"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm pt-2 border-t">
        <div>
          <span className="font-medium">duration: </span>
          {`${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60)
            .toFixed(0)
            .padStart(2, "0")}`}
        </div>
        <div>
          <span className="font-medium">bitrate: </span>
          {`${Math.round(metadata.bitrate)} kbps`}
        </div>
        <div>
          <span className="font-medium">sample rate: </span>
          {`${metadata.sampleRate} Hz`}
        </div>
      </div>
    </div>
  );
}
