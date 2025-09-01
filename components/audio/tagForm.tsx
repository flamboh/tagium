"use client";

import { useForm, SubmitHandler } from "react-hook-form";
import { z } from "zod";
import { Input } from "../ui/input";
import { AudioMetadata } from "./audioTagger";
import Form from "next/form";
import { Button } from "../ui/button";

export default function TagForm({ metadata }: { metadata: AudioMetadata }) {
  const { register, handleSubmit } = useForm<AudioMetadata>();

  const onSubmit: SubmitHandler<AudioMetadata> = (data) => {
    console.log(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="flex-1 grid grid-cols-1 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">title:</label>
          <Input defaultValue={metadata.title} {...register("title")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">artist:</label>
          <Input defaultValue={metadata.artist} {...register("artist")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">album:</label>
          <Input defaultValue={metadata.album} {...register("album")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">year:</label>
          <Input
            defaultValue={metadata.year ?? ""}
            type="number"
            {...register("year")}
          />
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
            {...register("genre")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium mb-1">track:</label>
            <Input
              defaultValue={metadata.trackNumber ?? ""}
              type="number"
              {...register("trackNumber")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">of</label>
            <Input
              defaultValue={metadata.trackTotal ?? ""}
              type="number"
              {...register("trackTotal")}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium mb-1">disc:</label>
            <Input
              defaultValue={metadata.discNumber ?? ""}
              type="number"
              {...register("discNumber")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">of</label>
            <Input
              defaultValue={metadata.discTotal ?? ""}
              type="number"
              {...register("discTotal")}
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
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
