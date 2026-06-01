import { Effect, FileSystem, Path } from "effect";
import {
  ConfigLoadError,
  ConfigValidationError,
  type DiscoveryError,
  defineConfig,
  type DevtuiConfig,
  type LogStoreBackend,
  type NoDevTasksDetectedError,
  type ProcessSpec,
  type ResolvedDevtuiConfig,
} from "./core/domain.ts";
import {
  formatPlan,
  ProjectDiscovery,
  type DiscoveryOptions,
  type PackageManagerName,
} from "./core/discovery.ts";
import * as ProjectDiscoveryLayer from "./core/discovery.ts";
import * as InfisicalIntegration from "./core/infisical.ts";
import * as PortAllocator from "./core/port-allocator.ts";
import * as PortlessIntegration from "./core/portless.ts";

export { defineConfig, type DevtuiConfig, type ProcessSpec, type ResolvedDevtuiConfig };
export { formatPlan };
export const layerInfisicalIntegration = InfisicalIntegration.layerCli;
export const layerProjectDiscovery = ProjectDiscoveryLayer.layer;
export const layerPortAllocator = PortAllocator.layer;
export const layerPortlessIntegration = PortlessIntegration.layer;
export {
  command,
  process,
  vitePlusDev,
  vitePlusRun,
  withEnv,
  withInfisical,
  withPortless,
} from "./presets.ts";

const findArgValue = (argv: readonly string[], names: readonly string[]) => {
  const index = argv.findIndex((arg) => names.includes(arg));
  if (index === -1) return undefined;
  return argv[index + 1];
};

const hasFlag = (argv: readonly string[], names: readonly string[]) =>
  argv.some((arg) => names.includes(arg));

const findArgValues = (argv: readonly string[], names: readonly string[]) =>
  argv.flatMap((arg, index) => (names.includes(arg) && argv[index + 1] ? [argv[index + 1]] : []));

const commandArgs = (argv: readonly string[]) => {
  if (argv[0] === "portless" && argv[1] === "dev") return ["dev", "--portless", ...argv.slice(2)];
  if (argv[0] === "dev") return argv;
  return ["dev", ...argv];
};

const managerFromArg = (value: string | undefined): PackageManagerName | "auto" => {
  switch (value) {
    case "bun":
    case "pnpm":
    case "yarn":
    case "npm":
      return value;
    default:
      return "auto";
  }
};

const logsFromArg = (value: string | undefined): LogStoreBackend | undefined => {
  switch (value) {
    case "memory":
    case "jsonl":
    case "sqlite":
      return value;
    default:
      return undefined;
  }
};

const envValue = (name: string) =>
  "process" in globalThis && typeof process === "object" && process !== null
    ? process.env[name]
    : undefined;

const envEnabled = (value: string | undefined) =>
  value === undefined ? undefined : !["0", "false", "no", "off"].includes(value.toLowerCase());

const parsePort = (value: string | undefined) => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
};

const envPortOverrides = () => {
  if (!("process" in globalThis) || typeof process !== "object" || process === null) return {};
  const entries = Object.entries(process.env).flatMap(([key, value]) => {
    if (!key.startsWith("DEVTUI_PORT_")) return [];
    const port = parsePort(value);
    if (port === undefined) return [];
    return [[key.slice("DEVTUI_PORT_".length).toLowerCase().replaceAll("_", "-"), port] as const];
  });
  const port = parsePort(process.env.PORT);
  return {
    ...(port === undefined ? {} : { "*": port }),
    ...Object.fromEntries(entries),
  };
};

const discoveryOptionsFromArgs = (argv: readonly string[]): DiscoveryOptions => {
  const args = commandArgs(argv);
  const infisicalEnvEnabled = envEnabled(envValue("DEVTUI_INFISICAL"));
  const infisicalWatchEnabled = envEnabled(envValue("DEVTUI_INFISICAL_WATCH"));
  const portlessEnvEnabled = envEnabled(envValue("DEVTUI_PORTLESS"));
  const portlessHttps = envEnabled(envValue("PORTLESS_HTTPS"));
  const portlessSyncHosts = envEnabled(envValue("PORTLESS_SYNC_HOSTS"));
  const infisicalPaths = findArgValues(args, ["--infisical-path"]);
  const envInfisicalPaths = envValue("DEVTUI_INFISICAL_PATHS")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const portlessProxyPort = parsePort(envValue("PORTLESS_PORT"));
  const portlessStateDir = envValue("PORTLESS_STATE_DIR");

  return {
    script: findArgValue(args, ["--script"]) ?? "dev",
    includes: findArgValues(args, ["--include"]),
    excludes: findArgValues(args, ["--exclude"]),
    manager: managerFromArg(findArgValue(args, ["--manager"])),
    infisical: hasFlag(args, ["--infisical"])
      ? "enabled"
      : hasFlag(args, ["--no-infisical"]) || infisicalEnvEnabled === false
        ? "disabled"
        : infisicalEnvEnabled === true
          ? "enabled"
          : "auto",
    infisicalEnv:
      findArgValue(args, ["--infisical-env"]) ?? envValue("DEVTUI_INFISICAL_ENV") ?? "dev",
    infisicalPaths: infisicalPaths.length > 0 ? infisicalPaths : (envInfisicalPaths ?? ["/"]),
    infisicalWatch: infisicalWatchEnabled ?? false,
    portless: hasFlag(args, ["--portless"])
      ? "enabled"
      : hasFlag(args, ["--no-portless"]) || portlessEnvEnabled === false
        ? "disabled"
        : portlessEnvEnabled === true
          ? "enabled"
          : "auto",
    portlessEnv: {
      ...(portlessProxyPort === undefined ? {} : { proxyPort: portlessProxyPort }),
      ...(portlessHttps === undefined ? {} : { https: portlessHttps }),
      ...(portlessSyncHosts === undefined ? {} : { syncHosts: portlessSyncHosts }),
      ...(portlessStateDir === undefined || portlessStateDir.length === 0
        ? {}
        : { stateDir: portlessStateDir }),
    },
    logs: logsFromArg(findArgValue(args, ["--logs"])),
    portOverrides: envPortOverrides(),
  };
};

export const shouldPrintPlan = (argv: readonly string[]) => {
  const args = commandArgs(argv);
  return hasFlag(args, ["--print-plan", "--dry-run"]);
};

export const shouldPrintConfig = (argv: readonly string[]) => {
  const args = commandArgs(argv);
  return hasFlag(args, ["--print-config"]);
};

export const formatConfig = (config: DevtuiConfig) =>
  [
    `import { defineConfig } from "devtui/config"`,
    "",
    `export default defineConfig(${JSON.stringify(config, null, 2)})`,
  ].join("\n");

const demoConfig = defineConfig({
  title: "devtui demo",
  processes: [
    {
      name: "api",
      command: `bun run ${new URL("../examples/noisy.ts", import.meta.url).pathname} api --delay 420 --fail-every 17`,
    },
    {
      name: "web",
      command: `bun run ${new URL("../examples/noisy.ts", import.meta.url).pathname} web --delay 650`,
    },
    {
      name: "worker",
      command: `bun run ${new URL("../examples/noisy.ts", import.meta.url).pathname} worker --delay 900 --fail-every 11`,
    },
  ],
});

const toReason = (cause: unknown) =>
  cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : String(cause);

const loadModuleConfig = (path: string): Effect.Effect<DevtuiConfig, ConfigLoadError> =>
  Effect.tryPromise({
    try: () => import(`${path}?t=${Date.now()}`),
    catch: (cause) => new ConfigLoadError({ path, reason: toReason(cause) }),
  }).pipe(
    Effect.flatMap((module) => {
      const config = module.default ?? module.config;
      if (!config || typeof config !== "object") {
        return Effect.fail(
          new ConfigLoadError({
            path,
            reason: "expected a default devtui config object",
          }),
        );
      }
      return Effect.succeed(config as DevtuiConfig);
    }),
  );

const validateConfig = (
  config: DevtuiConfig,
): Effect.Effect<DevtuiConfig, ConfigValidationError> => {
  if (!Array.isArray(config.processes) || config.processes.length === 0) {
    return Effect.fail(
      new ConfigValidationError({
        reason: "devtui config must include at least one process",
      }),
    );
  }
  const invalid = config.processes.find(
    (processSpec) => !processSpec.name.trim() || !processSpec.command.trim(),
  );
  if (invalid) {
    return Effect.fail(
      new ConfigValidationError({
        reason: `process "${invalid.name || "<unnamed>"}" needs a name and command`,
      }),
    );
  }
  return Effect.succeed(config);
};

export const resolveConfig = (
  argv: readonly string[],
): Effect.Effect<
  ResolvedDevtuiConfig,
  ConfigLoadError | ConfigValidationError | DiscoveryError | NoDevTasksDetectedError,
  FileSystem.FileSystem | Path.Path | ProjectDiscovery
> =>
  Effect.gen(function* () {
    const args = commandArgs(argv);
    const cwd = (yield* Path.Path).resolve(".");
    if (hasFlag(args, ["--demo"])) {
      return {
        config: demoConfig,
        source: "demo",
        root: cwd,
        diagnostics: [{ level: "info", message: "demo config requested" }],
      };
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const explicitPath = findArgValue(args, ["--config", "-c"]);
    const ignoreConfig = hasFlag(args, ["--ignore-config", "--auto"]);

    if (explicitPath) {
      const configPath = path.resolve(explicitPath);
      const config = yield* loadModuleConfig(configPath).pipe(Effect.flatMap(validateConfig));
      return {
        config,
        source: "explicit",
        root: path.dirname(configPath),
        diagnostics: [{ level: "info", message: `loaded explicit config: ${configPath}` }],
      };
    }

    const configPath = path.resolve("devtui.config.ts");
    if (!ignoreConfig && (yield* fs.exists(configPath).pipe(Effect.orElseSucceed(() => false)))) {
      const config = yield* loadModuleConfig(configPath).pipe(Effect.flatMap(validateConfig));
      return {
        config,
        source: "explicit",
        root: path.dirname(configPath),
        diagnostics: [{ level: "info", message: `loaded local config: ${configPath}` }],
      };
    }

    const discovery = yield* ProjectDiscovery;
    const discovered = yield* discovery.discover(cwd, discoveryOptionsFromArgs(args));
    const config = yield* validateConfig(discovered.config);
    return {
      config,
      source: "detected",
      root: discovered.project.root,
      diagnostics: discovered.diagnostics,
      plan: discovered.plan,
    };
  });

export const loadConfig = (argv: readonly string[]) =>
  resolveConfig(argv).pipe(Effect.map((resolved) => resolved.config));
