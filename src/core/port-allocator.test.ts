import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { PortAllocator, layerMemory } from "./port-allocator.ts";

const run = <A>(
  effect: Effect.Effect<A, unknown, PortAllocator>,
  reserved: readonly number[] = [],
) => Effect.runPromise(effect.pipe(Effect.provide(layerMemory({ reserved }))));

describe("PortAllocator", () => {
  test("reserves the preferred port when available", async () => {
    const reservation = await run(
      Effect.gen(function* () {
        const allocator = yield* PortAllocator;
        return yield* allocator.reserve({ label: "app", preferred: 5173 });
      }),
    );

    expect(reservation.port).toBe(5173);
  });

  test("skips reserved ports deterministically", async () => {
    const ports = await run(
      Effect.gen(function* () {
        const allocator = yield* PortAllocator;
        const first = yield* allocator.reserve({ label: "app", preferred: 5173 });
        const second = yield* allocator.reserve({ label: "docs", preferred: 5173 });
        return [first.port, second.port];
      }),
      [5174],
    );

    expect(ports).toEqual([5173, 5175]);
  });

  test("release makes a port available again", async () => {
    const ports = await run(
      Effect.gen(function* () {
        const allocator = yield* PortAllocator;
        const first = yield* allocator.reserve({ label: "app", preferred: 5173 });
        yield* first.release;
        const second = yield* allocator.reserve({ label: "docs", preferred: 5173 });
        return [first.port, second.port];
      }),
    );

    expect(ports).toEqual([5173, 5173]);
  });
});
