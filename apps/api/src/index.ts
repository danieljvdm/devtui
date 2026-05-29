import { Effect } from "effect";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

export default {
  fetch() {
    return Effect.runPromise(
      Effect.succeed(
        json({
          ok: true,
          service: "vp-effect-cf-api",
        }),
      ),
    );
  },
} satisfies ExportedHandler;
