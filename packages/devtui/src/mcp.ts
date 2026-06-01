#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import { Deferred, Effect, Layer, Path, Stdio } from "effect";
import {
  layerInfisicalIntegration,
  layerPortAllocator,
  layerPortlessIntegration,
  layerProjectDiscovery,
  resolveConfig,
} from "./config.ts";
import * as InstanceRegistry from "./core/instance-registry.ts";
import * as LogStore from "./core/log-store.ts";
import { layerStdio as layerMcpStdio } from "./core/mcp.ts";
import { makeProcessRunner } from "./core/runner.ts";
import { installSignalShutdown } from "./signals.ts";

const version = "0.1.0";

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

const main = Effect.scoped(
  Effect.gen(function* () {
    const shutdown = yield* Deferred.make<void>();
    yield* installSignalShutdown(shutdown);
    const scope = yield* Effect.scope;
    const context = yield* Effect.context<BunServices.BunServices>();
    const stdio = yield* Stdio.Stdio;
    const path = yield* Path.Path;
    const args = yield* stdio.args;
    const resolved = yield* resolveConfig(args);
    const cwd = resolved.root;
    const config = resolved.config;

    yield* Effect.gen(function* () {
      const runner = yield* makeProcessRunner(config, scope, context, {
        startupDiagnostics: resolved.diagnostics,
      });
      const instanceId = InstanceRegistry.instanceIdFor(cwd, config.title);

      yield* Effect.addFinalizer(() => runner.stopAll.pipe(Effect.catchCause(() => Effect.void)));
      yield* runner.startAll;
      yield* InstanceRegistry.registerHeartbeat({
        config,
        cwd,
        instanceId,
        mode: "mcp",
        pid: currentPid(),
        runner,
      });

      yield* Effect.raceFirst(
        Layer.launch(
          layerMcpStdio({
            config,
            runner,
            cwd,
            instanceId,
            version,
          }),
        ).pipe(Effect.provide(BunStdio.layer)),
        Deferred.await(shutdown),
      );
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
