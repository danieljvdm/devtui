import { describe, expect, test } from "bun:test";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { createServer } from "node:net";
import * as LogStore from "./log-store.ts";
import { makeProcessRunner } from "./runner.ts";

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a test port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const waitFor = async (
  check: () => Promise<boolean>,
  options: { readonly timeoutMs: number; readonly label: string },
) => {
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${options.label}`);
};

const canFetch = async (port: number) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`);
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
};

describe("ProcessRunner", () => {
  test("stopAll terminates shell-spawned process groups", async () => {
    const port = await getFreePort();
    const command = [
      "bun",
      "-e",
      `"Bun.serve({ hostname: '127.0.0.1', port: ${port}, fetch: () => new Response('ok') }); setInterval(() => {}, 1000);"`,
    ].join(" ");

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const context = yield* Effect.context<BunServices.BunServices>();
          const runner = yield* makeProcessRunner(
            {
              processes: [{ name: "server", command }],
            },
            scope,
            context,
          );

          yield* runner.startAll;
          yield* Effect.promise(() =>
            waitFor(() => canFetch(port), { timeoutMs: 5_000, label: "server to listen" }),
          );

          yield* runner.stopAll;
          yield* Effect.promise(() =>
            waitFor(async () => !(await canFetch(port)), {
              timeoutMs: 5_000,
              label: "server port to close",
            }),
          );
        }),
      ).pipe(Effect.provide(LogStore.layerMemory()), Effect.provide(BunServices.layer)),
    );

    expect(await canFetch(port)).toBe(false);
  });
});
