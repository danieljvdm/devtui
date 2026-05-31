#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { RegistryProvider } from "@effect/atom-react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Deferred, Effect, Path, Stdio } from "effect";
import { App } from "./App.tsx";
import {
  formatConfig,
  formatPlan,
  layerInfisicalIntegration,
  layerPortAllocator,
  layerPortlessIntegration,
  layerProjectDiscovery,
  resolveConfig,
  shouldPrintConfig,
  shouldPrintPlan,
} from "./config.ts";
import { makeClipboard } from "./core/clipboard.ts";
import { RendererError } from "./core/domain.ts";
import * as InstanceRegistry from "./core/instance-registry.ts";
import * as LogStore from "./core/log-store.ts";
import { makeProcessRunner } from "./core/runner.ts";

const toReason = (cause: unknown) =>
  cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : String(cause);

const currentPid = () =>
  "process" in globalThis &&
  typeof process === "object" &&
  process !== null &&
  typeof process.pid === "number"
    ? process.pid
    : null;

const registryDirectory = (path: Path.Path) => {
  const envDirectory =
    "process" in globalThis && typeof process === "object" && process !== null
      ? process.env.DEVTUI_REGISTRY_DIR
      : undefined;
  if (envDirectory && envDirectory.length > 0) return path.resolve(envDirectory);

  const home =
    "process" in globalThis && typeof process === "object" && process !== null
      ? process.env.HOME
      : undefined;
  return home && home.length > 0
    ? path.join(home, ".devtui", "instances")
    : path.resolve(".devtui", "instances");
};

const makeRenderer = (shutdown: Deferred.Deferred<void>) =>
  Effect.tryPromise({
    try: () =>
      createCliRenderer({
        exitOnCtrlC: false,
        screenMode: "alternate-screen",
        onDestroy: () => {
          Effect.runFork(Deferred.succeed(shutdown, undefined));
        },
      }),
    catch: (cause) => new RendererError({ reason: toReason(cause) }),
  });

const main = Effect.scoped(
  Effect.gen(function* () {
    const shutdown = yield* Deferred.make<void>();
    const scope = yield* Effect.scope;
    const context = yield* Effect.context<BunServices.BunServices>();
    const stdio = yield* Stdio.Stdio;
    const path = yield* Path.Path;
    const args = yield* stdio.args;
    const resolved = yield* resolveConfig(args);
    if (shouldPrintPlan(args)) {
      yield* Effect.sync(() => {
        console.log(
          resolved.plan
            ? formatPlan(resolved.plan, resolved.diagnostics)
            : [
                "devtui config plan",
                `source: ${resolved.source}`,
                `root: ${resolved.root}`,
                `processes: ${resolved.config.processes.map((process) => process.name).join(", ")}`,
              ].join("\n"),
        );
      });
      return;
    }
    if (shouldPrintConfig(args)) {
      yield* Effect.sync(() => {
        console.log(formatConfig(resolved.config));
      });
      return;
    }
    const cwd = resolved.root;
    const config = resolved.config;
    const clipboard = yield* makeClipboard;

    yield* Effect.gen(function* () {
      const runner = yield* makeProcessRunner(config, scope, context, {
        startupDiagnostics: resolved.diagnostics,
      });
      const renderer = yield* makeRenderer(shutdown);

      yield* Effect.addFinalizer(() => runner.stopAll.pipe(Effect.catchCause(() => Effect.void)));
      yield* runner.startAll;
      yield* InstanceRegistry.registerHeartbeat({
        config,
        cwd,
        instanceId: InstanceRegistry.instanceIdFor(cwd, config.title),
        mode: "tui",
        pid: currentPid(),
        runner,
      });
      yield* Effect.sync(() => {
        createRoot(renderer).render(
          <RegistryProvider>
            <App clipboard={clipboard} config={config} runner={runner} />
          </RegistryProvider>,
        );
      });
      yield* Deferred.await(shutdown);
    }).pipe(
      Effect.provide(LogStore.makeLayer(config.logs)),
      Effect.provide(InstanceRegistry.layerFile({ directory: registryDirectory(path) })),
    );
  }),
).pipe(
  Effect.provide(layerProjectDiscovery),
  Effect.provide(layerInfisicalIntegration),
  Effect.provide(layerPortAllocator),
  Effect.provide(layerPortlessIntegration),
  Effect.provide(BunServices.layer),
);

BunRuntime.runMain(main);
