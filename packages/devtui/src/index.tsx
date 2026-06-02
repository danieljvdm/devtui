#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { RegistryProvider } from "@effect/atom-react";
import {
  buildKittyKeyboardFlags,
  CliRenderer,
  resolveRenderLib,
  type CliRendererConfig,
} from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Deferred, Duration, Effect, FileSystem, Path, Stdio } from "effect";
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
import { installSignalShutdown } from "./signals.ts";
import { inferThemeName } from "./theme.ts";
import { hideTerminalCursor, keepTerminalCursorHidden, showTerminalCursor } from "./ui/cursor.ts";

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

const drainLateTerminalReplies = Effect.acquireUseRelease(
  Effect.sync(() => {
    if (
      !("process" in globalThis) ||
      typeof process !== "object" ||
      process === null ||
      !process.stdin ||
      typeof process.stdin.on !== "function" ||
      typeof process.stdin.removeListener !== "function"
    ) {
      return () => {};
    }

    const onData = () => {
      // OpenTUI can leave terminal query replies in flight while the renderer
      // tears down. Swallow the brief tail so zsh doesn't receive OSC/CSI bytes
      // as typed input after devtui exits.
    };

    process.stdin.on("data", onData);
    process.stdin.resume();
    return () => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
    };
  }),
  () => Effect.sleep(Duration.millis(200)),
  (cleanup) => Effect.sync(cleanup),
);

const terminalQueryPatterns = [
  /\x1b\[\?997\$p/g,
  /\x1b\](?:4;\d+|10|11);\?\x07/g,
  /\x1b\[(?:14|16)t/g,
  /\x1b\[\?25h/g,
] as const;

const stripTerminalQueries = (value: string) =>
  terminalQueryPatterns.reduce((next, pattern) => next.replace(pattern, ""), value);

const makeQuietStdout = () => {
  if (
    !("process" in globalThis) ||
    typeof process !== "object" ||
    process === null ||
    !process.stdout
  ) {
    return undefined;
  }

  const stdout = process.stdout;
  const quietStdout = Object.create(stdout) as NodeJS.WriteStream;
  quietStdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? new TextDecoder().decode(chunk)
          : null;
    if (text === null) {
      return stdout.write(
        chunk as string,
        encoding as BufferEncoding | undefined,
        callback as ((error?: Error | null) => void) | undefined,
      );
    }

    const filtered = stripTerminalQueries(text);
    if (filtered.length === 0) {
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    }

    return stdout.write(
      filtered,
      (typeof encoding === "string" ? encoding : undefined) as BufferEncoding | undefined,
      (typeof encoding === "function" ? encoding : callback) as
        | ((error?: Error | null) => void)
        | undefined,
    );
  }) as NodeJS.WriteStream["write"];
  return quietStdout;
};

const enterAlternateScreen = `\x1b[?1049h\x1b[H\x1b[2J${hideTerminalCursor}`;
const leaveAlternateScreen = `${showTerminalCursor}\x1b[?1049l`;

const rendererGeometry = (
  screenMode: CliRendererConfig["screenMode"],
  width: number,
  height: number,
  footerHeight: number,
) => {
  const safeWidth = Math.max(width, 0);
  const safeHeight = Math.max(height, 0);
  if (screenMode !== "split-footer") {
    return { renderWidth: safeWidth, renderHeight: safeHeight };
  }
  return { renderWidth: safeWidth, renderHeight: Math.min(footerHeight, safeHeight) };
};

const setupInputWithoutTerminalProbes = (renderer: CliRenderer) => {
  (renderer as unknown as { setupInput: () => void }).setupInput();
};

const makeRendererWithoutTerminalProbes = (config: CliRendererConfig) => {
  const stdin = config.stdin || process.stdin;
  const stdout = config.stdout || process.stdout;
  const width = stdout.columns || 80;
  const height = stdout.rows || 24;
  const screenMode = config.screenMode ?? "alternate-screen";
  const footerHeight = config.footerHeight ?? 12;
  const geometry = rendererGeometry(screenMode, width, height, footerHeight);
  const ziglib = resolveRenderLib();
  const rendererPtr = ziglib.createRenderer(geometry.renderWidth, geometry.renderHeight, {
    remote: config.remote ?? false,
    testing: config.testing ?? false,
  });
  if (!rendererPtr) {
    throw new Error("Failed to create renderer");
  }

  const useThread = config.useThread ?? ("process" in globalThis && process.platform !== "linux");
  ziglib.setUseThread(rendererPtr, useThread);
  ziglib.setKittyKeyboardFlags(rendererPtr, buildKittyKeyboardFlags(config.useKittyKeyboard));

  const renderer = new CliRenderer(ziglib, rendererPtr, stdin, stdout, width, height, config);
  stdout.write(enterAlternateScreen);
  setupInputWithoutTerminalProbes(renderer);
  renderer.start();
  keepTerminalCursorHidden(renderer, stdout);
  return renderer;
};

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

const readGhosttyConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath =
    process.env.DEVTUI_GHOSTTY_CONFIG ??
    (process.env.HOME ? path.join(process.env.HOME, ".config", "ghostty", "config") : null);
  if (configPath === null) return "";
  return yield* fs.readFileString(configPath).pipe(Effect.orElseSucceed(() => ""));
});

const detectInitialTheme = Effect.gen(function* () {
  const ghosttyConfig = yield* readGhosttyConfig;
  return inferThemeName({ env: process.env, ghosttyConfig }) ?? "system";
});

const makeRenderer = (shutdown: Deferred.Deferred<void>) =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(
        makeRendererWithoutTerminalProbes({
          exitOnCtrlC: false,
          screenMode: "alternate-screen",
          useKittyKeyboard: null,
          stdout: makeQuietStdout(),
          onDestroy: () => {
            process.stdout.write(leaveAlternateScreen);
            Effect.runFork(Deferred.succeed(shutdown, undefined));
          },
        }),
      ),
    catch: (cause) => new RendererError({ reason: toReason(cause) }),
  });

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
    const initialThemeName = yield* detectInitialTheme;

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
            <App
              clipboard={clipboard}
              config={config}
              initialThemeName={initialThemeName}
              runner={runner}
            />
          </RegistryProvider>,
        );
      });
      yield* Deferred.await(shutdown);
      yield* drainLateTerminalReplies;
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
