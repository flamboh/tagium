import { Effect, Layer, ManagedRuntime } from "effect";

export const makeAudioRuntime = <R, E>(layer: Layer.Layer<R, E, never>) =>
  ManagedRuntime.make(layer);

export const runAudioEffectWithoutServices = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);
