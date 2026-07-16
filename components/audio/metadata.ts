import { Schema } from "effect";

const optionalMutableKey = <S extends Schema.Constraint>(schema: S) =>
  Schema.optionalKey(Schema.mutableKey(schema));

const metadataPictureDataSchema = Schema.declare<Uint8Array<ArrayBuffer>>(
  (input): input is Uint8Array<ArrayBuffer> =>
    input instanceof Uint8Array && input.buffer instanceof ArrayBuffer,
  { expected: "Uint8Array" },
);

const metadataPictureSchema = Schema.Struct({
  format: Schema.mutableKey(Schema.String),
  type: Schema.mutableKey(Schema.Number),
  description: Schema.mutableKey(Schema.String),
  data: Schema.mutableKey(metadataPictureDataSchema),
});

const metadataGenreSchema = Schema.Union([
  Schema.String,
  Schema.mutable(Schema.Array(Schema.String)),
]);

const metadataPictureArraySchema = Schema.mutable(Schema.Array(metadataPictureSchema));

const metadataSnapshotSchema = Schema.Struct({
  filename: Schema.mutableKey(Schema.String),
  title: Schema.mutableKey(Schema.String),
  artist: Schema.mutableKey(Schema.String),
  album: Schema.mutableKey(Schema.String),
  year: Schema.mutableKey(Schema.NullOr(Schema.Number)),
  genre: Schema.mutableKey(metadataGenreSchema),
  duration: Schema.mutableKey(Schema.Number),
  bitrate: Schema.mutableKey(Schema.Number),
  sampleRate: Schema.mutableKey(Schema.Number),
  picture: Schema.mutableKey(metadataPictureArraySchema),
  trackNumber: Schema.mutableKey(Schema.NullOr(Schema.Number)),
});

const metadataPatchSchema = Schema.Struct({
  filename: optionalMutableKey(Schema.String),
  title: optionalMutableKey(Schema.String),
  artist: optionalMutableKey(Schema.String),
  album: optionalMutableKey(Schema.String),
  year: optionalMutableKey(Schema.NullOr(Schema.Number)),
  genre: optionalMutableKey(metadataGenreSchema),
  picture: optionalMutableKey(metadataPictureArraySchema),
  trackNumber: optionalMutableKey(Schema.NullOr(Schema.Number)),
});

export const audioMetadataSchema = metadataSnapshotSchema;

export type MetadataPatch = Schema.Schema.Type<typeof metadataPatchSchema>;
export type AudioMetadata = Schema.Schema.Type<typeof metadataSnapshotSchema>;
