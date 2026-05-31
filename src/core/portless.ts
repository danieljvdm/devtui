import { Context, Effect, Layer } from "effect";
import type { Endpoint, PlanDiagnostic, ProcessSpec } from "./domain.ts";

export interface PortlessEnvOptions {
  readonly proxyPort?: number;
  readonly https?: boolean;
  readonly syncHosts?: boolean;
  readonly stateDir?: string;
}

export interface PortlessPlanInput {
  readonly mode: "auto" | "enabled" | "disabled";
  readonly hasConfig: boolean;
  readonly env: PortlessEnvOptions;
}

export interface PortlessTask {
  readonly name: string;
  readonly kind: "app" | "api" | "worker" | "library" | "unknown";
  readonly appPort?: number;
}

export interface PortlessPlan {
  readonly enabled: boolean;
  readonly reason: string;
  readonly diagnostics: readonly PlanDiagnostic[];
  readonly endpointSourceFor: (task: Pick<PortlessTask, "kind">) => Endpoint["source"];
  readonly wrap: (spec: ProcessSpec, task: PortlessTask) => ProcessSpec;
}

export class PortlessIntegration extends Context.Service<
  PortlessIntegration,
  {
    readonly plan: (input: PortlessPlanInput) => Effect.Effect<PortlessPlan>;
  }
>()("devtui/PortlessIntegration") {}

const needsShellQuotes = /[\s"'`$\\|&;<>(){}\[\]*?!#~]/;

const shellQuote = (value: string) =>
  value.length === 0 || needsShellQuotes.test(value)
    ? `'${value.replaceAll("'", `'"'"'`)}'`
    : value;

const portlessEnv = (options: PortlessEnvOptions): Readonly<Record<string, string>> => ({
  ...(options.proxyPort === undefined ? {} : { PORTLESS_PORT: String(options.proxyPort) }),
  ...(options.https === undefined ? {} : { PORTLESS_HTTPS: options.https ? "1" : "0" }),
  ...(options.syncHosts === undefined
    ? {}
    : { PORTLESS_SYNC_HOSTS: options.syncHosts ? "1" : "0" }),
  ...(options.stateDir === undefined ? {} : { PORTLESS_STATE_DIR: options.stateDir }),
});

const shouldWrap = (task: Pick<PortlessTask, "kind">) => task.kind === "app";

const disabledPlan = (reason: string): PortlessPlan => ({
  enabled: false,
  reason,
  diagnostics: [],
  endpointSourceFor: () => "detected",
  wrap: (spec) => spec,
});

const enabledPlan = (reason: string, envOptions: PortlessEnvOptions): PortlessPlan => ({
  enabled: true,
  reason,
  diagnostics: [],
  endpointSourceFor: (task) => (shouldWrap(task) ? "portless" : "detected"),
  wrap: (spec, task) => {
    if (!shouldWrap(task)) return spec;

    const extraEnv = portlessEnv(envOptions);
    const env =
      spec.env === undefined && Object.keys(extraEnv).length === 0
        ? undefined
        : { ...spec.env, ...extraEnv };
    const args = [
      "portless",
      "run",
      "--name",
      task.name,
      ...(task.appPort === undefined ? [] : ["--app-port", String(task.appPort)]),
      spec.command,
    ];

    return {
      ...spec,
      command: args
        .map((part, index) => (index === args.length - 1 ? part : shellQuote(part)))
        .join(" "),
      env,
    };
  },
});

export const make: Effect.Effect<typeof PortlessIntegration.Service> = Effect.succeed(
  PortlessIntegration.of({
    plan: (input) =>
      Effect.succeed(
        input.mode === "disabled"
          ? disabledPlan("disabled")
          : input.mode === "enabled"
            ? enabledPlan("--portless", input.env)
            : input.hasConfig
              ? enabledPlan("portless.json", input.env)
              : disabledPlan("no portless.json"),
      ),
  }),
);

export const layer: Layer.Layer<PortlessIntegration> = Layer.effect(PortlessIntegration, make);
