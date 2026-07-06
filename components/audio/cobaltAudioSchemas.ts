import { Schema } from "effect";

const cobaltOutputMetadataSchema = Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String));

const cobaltTunnelDownloadPlanSchema = Schema.Struct({
  status: Schema.Literal("tunnel"),
  url: Schema.String,
  filename: Schema.String,
});

const cobaltLocalDownloadPlanSchema = Schema.Struct({
  status: Schema.Literal("local-processing"),
  type: Schema.Literal("audio"),
  tunnel: Schema.Array(Schema.String),
  output: Schema.Struct({
    type: Schema.String,
    filename: Schema.String,
    metadata: Schema.optionalKey(cobaltOutputMetadataSchema),
  }),
  audio: Schema.Struct({
    copy: Schema.Boolean,
    format: Schema.String,
    bitrate: Schema.String,
    cover: Schema.optionalKey(Schema.Boolean),
    cropCover: Schema.optionalKey(Schema.Boolean),
  }),
});

export const cobaltDownloadPlanSchema = Schema.Union([
  cobaltTunnelDownloadPlanSchema,
  cobaltLocalDownloadPlanSchema,
]);

export const cobaltLocalProcessingMessageSchema = Schema.Struct({
  cobaltLocalProcessing: Schema.Union([
    Schema.Struct({
      blob: Schema.instanceOf(Blob),
    }),
    Schema.Struct({
      error: Schema.String,
    }),
  ]),
});

export const decodeCobaltDownloadPlan = Schema.decodeUnknownSync(cobaltDownloadPlanSchema);
export const decodeCobaltLocalProcessingMessage = Schema.decodeUnknownSync(
  cobaltLocalProcessingMessageSchema,
);
