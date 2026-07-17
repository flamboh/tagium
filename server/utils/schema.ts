import { Effect, Schema } from "effect";
import { HTTPError } from "nitro";

export const urlStringSchema = Schema.Trim.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return "Expected a valid URL";
    }
  }),
);

export const decodeRequestBody = async <S extends Schema.ConstraintDecoder<unknown, never>>(
  request: Request,
  schema: S,
): Promise<S["Type"]> => {
  let body: unknown;

  try {
    body = await request.json();
  } catch (cause) {
    throw new HTTPError({
      status: 400,
      message: "Invalid request body: expected valid JSON.",
      cause,
    });
  }

  return Effect.runPromise(
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(
        (cause) =>
          new HTTPError({
            status: 400,
            message: `Invalid request body: ${cause.message}`,
            cause,
          }),
      ),
    ),
  );
};
