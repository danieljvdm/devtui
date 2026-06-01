import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class ClipboardError extends Schema.TaggedErrorClass<ClipboardError>()("ClipboardError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Clipboard write failed: ${this.reason}`;
  }
}

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly writeText: (text: string) => Effect.Effect<void, ClipboardError>;
  }
>()("devtui/Clipboard") {
  static readonly layerPbcopy = Layer.effect(
    Clipboard,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const writeText = (text: string) =>
        Effect.gen(function* () {
          const exitCode = yield* spawner
            .exitCode(
              ChildProcess.make("pbcopy", {
                stdin: Stream.make(new TextEncoder().encode(text)),
                stdout: "ignore",
                stderr: "ignore",
              }),
            )
            .pipe(Effect.mapError((cause) => new ClipboardError({ reason: String(cause) })));

          if (Number(exitCode) !== 0) {
            return yield* Effect.fail(
              new ClipboardError({ reason: `pbcopy exited with code ${Number(exitCode)}` }),
            );
          }
        });

      return Clipboard.of({ writeText });
    }),
  );
}

export interface ClipboardRuntime {
  readonly writeText: (text: string) => Effect.Effect<void, ClipboardError>;
}

export const makeClipboard: Effect.Effect<
  ClipboardRuntime,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const clipboard = yield* Clipboard;

  return {
    writeText: clipboard.writeText,
  };
}).pipe(Effect.provide(Clipboard.layerPbcopy), Effect.orDie);
