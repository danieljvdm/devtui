import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { DiscoveryError, type PlanDiagnostic, type ProcessSpec } from "./domain.ts";

export interface InfisicalPlanInput {
  readonly mode: "auto" | "enabled" | "disabled";
  readonly hasConfig: boolean;
  readonly root: string;
  readonly env: string;
  readonly paths: readonly string[];
  readonly watch: boolean;
}

export interface InfisicalPlan {
  readonly enabled: boolean;
  readonly reason: string;
  readonly diagnostics: readonly PlanDiagnostic[];
  readonly wrap: (spec: ProcessSpec) => ProcessSpec;
}

export class InfisicalIntegration extends Context.Service<
  InfisicalIntegration,
  {
    readonly plan: (input: InfisicalPlanInput) => Effect.Effect<InfisicalPlan, DiscoveryError>;
  }
>()("devtui/InfisicalIntegration") {}

export class InfisicalSecretRedactionError extends Schema.TaggedErrorClass<InfisicalSecretRedactionError>()(
  "InfisicalSecretRedactionError",
  {
    reason: Schema.String,
  },
) {}

const needsShellQuotes = /[\s"'`$\\|&;<>(){}\[\]*?!#~]/;

const shellQuote = (value: string) =>
  value.length === 0 || needsShellQuotes.test(value)
    ? `'${value.replaceAll("'", `'"'"'`)}'`
    : value;

const disabledPlan = (
  reason: string,
  diagnostics: readonly PlanDiagnostic[] = [],
): InfisicalPlan => ({
  enabled: false,
  reason,
  diagnostics,
  wrap: (spec) => spec,
});

const enabledPlan = (input: InfisicalPlanInput, reason: string): InfisicalPlan => ({
  enabled: true,
  reason,
  diagnostics: [],
  wrap: (spec) => {
    const args = [
      "infisical",
      "run",
      "--project-config-dir",
      input.root,
      "--env",
      input.env,
      ...input.paths.flatMap((path) => ["--path", path]),
      ...(input.watch ? ["--watch"] : []),
      "--",
      spec.command,
    ];

    return {
      ...spec,
      command: args
        .map((part, index) => (index === args.length - 1 ? part : shellQuote(part)))
        .join(" "),
    };
  },
});

export const make = (options: {
  readonly isCliAvailable: Effect.Effect<boolean, never>;
}): Effect.Effect<typeof InfisicalIntegration.Service> =>
  Effect.gen(function* () {
    const plan = (input: InfisicalPlanInput) =>
      Effect.gen(function* () {
        if (input.mode === "disabled") return disabledPlan("disabled");
        if (input.mode === "auto" && !input.hasConfig) return disabledPlan("no .infisical.json");

        const available = yield* options.isCliAvailable;
        if (!available && input.mode === "enabled") {
          return yield* Effect.fail(
            new DiscoveryError({
              operation: "plan infisical",
              reason:
                "Infisical was required with --infisical, but the infisical CLI is not available",
            }),
          );
        }
        if (!available) {
          return disabledPlan("infisical CLI unavailable", [
            {
              level: "warn",
              message:
                "infisical: .infisical.json found, but the infisical CLI is not available; continuing without secrets",
            },
          ]);
        }

        return enabledPlan(input, input.mode === "enabled" ? "--infisical" : ".infisical.json");
      });

    return InfisicalIntegration.of({ plan });
  });

export const layerFake = (options: {
  readonly available: boolean;
}): Layer.Layer<InfisicalIntegration> =>
  Layer.effect(InfisicalIntegration, make({ isCliAvailable: Effect.succeed(options.available) }));

export const layerCli: Layer.Layer<
  InfisicalIntegration,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  InfisicalIntegration,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const isCliAvailable = spawner
      .exitCode(
        ChildProcess.make("infisical", ["--version"], {
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.map((exitCode) => Number(exitCode) === 0),
        Effect.catchCause(() => Effect.succeed(false)),
      );

    return yield* make({ isCliAvailable });
  }),
);
