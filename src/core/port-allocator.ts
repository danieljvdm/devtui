import { Context, Effect, Layer, Ref } from "effect";
import { DiscoveryError } from "./domain.ts";

export interface PortRequest {
  readonly label: string;
  readonly preferred: number;
}

export interface PortReservation {
  readonly label: string;
  readonly port: number;
  readonly release: Effect.Effect<void>;
}

export class PortAllocator extends Context.Service<
  PortAllocator,
  {
    readonly reserve: (request: PortRequest) => Effect.Effect<PortReservation, DiscoveryError>;
  }
>()("devtui/PortAllocator") {}

export const layerMemory = (
  options: {
    readonly reserved?: Iterable<number>;
  } = {},
): Layer.Layer<PortAllocator> =>
  Layer.effect(
    PortAllocator,
    Effect.gen(function* () {
      const reservedRef = yield* Ref.make(new Set(options.reserved ?? []));

      const reserve = (request: PortRequest) =>
        Effect.gen(function* () {
          if (
            !Number.isInteger(request.preferred) ||
            request.preferred <= 0 ||
            request.preferred > 65_535
          ) {
            return yield* Effect.fail(
              new DiscoveryError({
                operation: "allocate port",
                reason: `invalid preferred port for ${request.label}: ${request.preferred}`,
              }),
            );
          }

          const port = yield* Ref.modify(reservedRef, (reserved) => {
            let candidate = request.preferred;
            while (reserved.has(candidate)) candidate += 1;
            const next = new Set(reserved);
            next.add(candidate);
            return [candidate, next];
          });

          return {
            label: request.label,
            port,
            release: Ref.update(reservedRef, (reserved) => {
              const next = new Set(reserved);
              next.delete(port);
              return next;
            }),
          };
        });

      return { reserve };
    }),
  );

export const layer = layerMemory();
