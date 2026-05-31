#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import { Effect, Layer, Path } from "effect";
import * as InstanceRegistry from "./core/instance-registry.ts";
import { layerStdio as layerBrokerStdio } from "./core/mcp-broker.ts";

const version = "0.0.0";

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

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  yield* Layer.launch(layerBrokerStdio({ version })).pipe(
    Effect.provide(BunStdio.layer),
    Effect.provide(InstanceRegistry.layerFile({ directory: registryDirectory(path) })),
  );
}).pipe(Effect.provide(BunServices.layer));

BunRuntime.runMain(main);
