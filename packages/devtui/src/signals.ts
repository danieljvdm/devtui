import { Deferred, Effect } from "effect";

const shutdownSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const currentProcess = () =>
  "process" in globalThis &&
  typeof process === "object" &&
  process !== null &&
  typeof process.on === "function" &&
  typeof process.removeListener === "function"
    ? process
    : null;

export const installSignalShutdown = (shutdown: Deferred.Deferred<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const proc = currentProcess();
      if (!proc) return null;

      let requested = false;
      const handler = () => {
        if (requested) return;
        requested = true;
        Effect.runFork(Deferred.succeed(shutdown, undefined));
      };

      for (const signal of shutdownSignals) {
        proc.on(signal, handler);
      }

      return { handler, proc };
    }),
    (registration) =>
      Effect.sync(() => {
        if (!registration) return;
        for (const signal of shutdownSignals) {
          registration.proc.removeListener(signal, registration.handler);
        }
      }),
  ).pipe(Effect.asVoid);
