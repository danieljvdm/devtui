import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  SubscriptionRef,
} from "effect";
import {
  InstanceRegistryError,
  type Endpoint,
  type DevtuiConfig,
  type ProcessRuntime,
  type RunnerSnapshot,
} from "./domain.ts";
import type { ProcessRunner } from "./runner.ts";

export type DevtuiInstanceMode = "tui" | "mcp";

export interface RegisteredProcess {
  readonly id: string;
  readonly name: string;
  readonly status: ProcessRuntime["status"];
  readonly endpoints: readonly Endpoint[];
  readonly pid: number | null;
  readonly lineCount: number;
  readonly errorCount: number;
}

export interface RegisteredInstance {
  readonly instanceId: string;
  readonly title: string;
  readonly cwd: string;
  readonly mode: DevtuiInstanceMode;
  readonly pid: number | null;
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly storage: string;
  readonly logPath: string | null;
  readonly controlDirectory: string;
  readonly processCount: number;
  readonly logCount: number;
  readonly processes: readonly RegisteredProcess[];
}

export type InstanceControlAction = "restartProcess" | "stopProcess" | "clearLogs";

export interface InstanceControlCommand {
  readonly commandId: string;
  readonly action: InstanceControlAction;
  readonly processId?: string;
  readonly processName?: string;
  readonly createdAtMs: number;
}

export interface RegisterOptions {
  readonly config: DevtuiConfig;
  readonly cwd: string;
  readonly instanceId: string;
  readonly mode: DevtuiInstanceMode;
  readonly pid?: number | null;
  readonly runner: ProcessRunner;
}

export class InstanceRegistry extends Context.Service<
  InstanceRegistry,
  {
    readonly directory: string;
    readonly list: Effect.Effect<readonly RegisteredInstance[], InstanceRegistryError>;
    readonly remove: (instanceId: string) => Effect.Effect<void, InstanceRegistryError>;
    readonly write: (instance: RegisteredInstance) => Effect.Effect<void, InstanceRegistryError>;
  }
>()("devtui/InstanceRegistry") {}

const toReason = (cause: unknown) =>
  Cause.isCause(cause)
    ? Cause.pretty(cause)
    : cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : String(cause);

export const instanceIdFor = (cwd: string, title: string | undefined) =>
  `${title ?? "devtui"}:${cwd}`;

const registryFileName = (instanceId: string) =>
  `${encodeURIComponent(instanceId).replaceAll("%", "_")}.json`;

const registrySlug = (instanceId: string) => encodeURIComponent(instanceId).replaceAll("%", "_");

const processSummary = (process: ProcessRuntime): RegisteredProcess => ({
  id: process.id,
  name: process.spec.name,
  status: process.status,
  endpoints: process.endpoints,
  pid: process.pid,
  lineCount: process.lineCount,
  errorCount: process.errorCount,
});

const logPathFor = (path: Path.Path, cwd: string, config: DevtuiConfig) => {
  if (config.logs?.storage !== "jsonl") return null;
  const configured = config.logs.path ?? ".devtui/logs.jsonl";
  return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
};

const storageLabel = (config: DevtuiConfig) => config.logs?.storage ?? "memory";

const toRegisteredInstance = (
  path: Path.Path,
  options: RegisterOptions,
  controlDirectory: string,
  startedAtMs: number,
  updatedAtMs: number,
  snapshot: RunnerSnapshot,
): RegisteredInstance => ({
  instanceId: options.instanceId,
  title: options.config.title ?? "devtui",
  cwd: options.cwd,
  mode: options.mode,
  pid: options.pid ?? null,
  startedAtMs,
  updatedAtMs,
  storage: storageLabel(options.config),
  logPath: logPathFor(path, options.cwd, options.config),
  controlDirectory,
  processCount: snapshot.processes.length,
  logCount: snapshot.logs.length,
  processes: snapshot.processes.map(processSummary),
});

const decodeInstance = (value: unknown): RegisteredInstance | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.instanceId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.cwd !== "string" ||
    (record.mode !== "tui" && record.mode !== "mcp") ||
    typeof record.startedAtMs !== "number" ||
    typeof record.updatedAtMs !== "number" ||
    typeof record.storage !== "string" ||
    typeof record.processCount !== "number" ||
    typeof record.logCount !== "number" ||
    !Array.isArray(record.processes)
  ) {
    return null;
  }

  return {
    instanceId: record.instanceId,
    title: record.title,
    cwd: record.cwd,
    mode: record.mode,
    pid: typeof record.pid === "number" ? record.pid : null,
    startedAtMs: record.startedAtMs,
    updatedAtMs: record.updatedAtMs,
    storage: record.storage,
    logPath: typeof record.logPath === "string" ? record.logPath : null,
    controlDirectory: typeof record.controlDirectory === "string" ? record.controlDirectory : "",
    processCount: record.processCount,
    logCount: record.logCount,
    processes: record.processes.flatMap((process) => {
      if (process === null || typeof process !== "object") return [];
      const candidate = process as Record<string, unknown>;
      return typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.status === "string" &&
        typeof candidate.lineCount === "number" &&
        typeof candidate.errorCount === "number"
        ? [
            {
              id: candidate.id,
              name: candidate.name,
              status: candidate.status as ProcessRuntime["status"],
              endpoints: Array.isArray(candidate.endpoints)
                ? candidate.endpoints.flatMap((endpoint) => {
                    if (endpoint === null || typeof endpoint !== "object") return [];
                    const endpointRecord = endpoint as Record<string, unknown>;
                    return typeof endpointRecord.label === "string" &&
                      typeof endpointRecord.url === "string" &&
                      (endpointRecord.source === "detected" ||
                        endpointRecord.source === "portless" ||
                        endpointRecord.source === "log" ||
                        endpointRecord.source === "config")
                      ? [
                          {
                            label: endpointRecord.label,
                            url: endpointRecord.url,
                            port:
                              typeof endpointRecord.port === "number"
                                ? endpointRecord.port
                                : undefined,
                            source: endpointRecord.source,
                          },
                        ]
                      : [];
                  })
                : [],
              pid: typeof candidate.pid === "number" ? candidate.pid : null,
              lineCount: candidate.lineCount,
              errorCount: candidate.errorCount,
            },
          ]
        : [];
    }),
  };
};

export const layerFile = (options: {
  readonly directory: string;
}): Layer.Layer<InstanceRegistry, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    InstanceRegistry,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = options.directory;
      const prepare = fs
        .makeDirectory(directory, { recursive: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new InstanceRegistryError({ operation: "prepare", reason: toReason(cause) }),
            ),
          ),
        );
      const fileFor = (instanceId: string) => path.join(directory, registryFileName(instanceId));

      return InstanceRegistry.of({
        directory,
        list: Effect.gen(function* () {
          yield* prepare;
          const files = yield* fs
            .readDirectory(directory)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new InstanceRegistryError({ operation: "list", reason: toReason(cause) }),
                ),
              ),
            );
          const instances = yield* Effect.forEach(
            files.filter((file) => file.endsWith(".json")),
            (file) =>
              fs.readFileString(path.join(directory, file)).pipe(
                Effect.flatMap((content) =>
                  Effect.try({
                    try: () => JSON.parse(content) as unknown,
                    catch: () => null,
                  }),
                ),
                Effect.map(decodeInstance),
                Effect.catchCause(() => Effect.succeed(null)),
              ),
          );
          return instances
            .filter((instance): instance is RegisteredInstance => instance !== null)
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
        }),
        remove: (instanceId) =>
          fs
            .remove(fileFor(instanceId))
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new InstanceRegistryError({ operation: "remove", reason: toReason(cause) }),
                ),
              ),
            ),
        write: (instance) =>
          Effect.gen(function* () {
            yield* prepare;
            yield* fs
              .writeFileString(
                fileFor(instance.instanceId),
                `${JSON.stringify(instance, null, 2)}\n`,
              )
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.fail(
                    new InstanceRegistryError({ operation: "write", reason: toReason(cause) }),
                  ),
                ),
              );
          }),
      });
    }),
  );

const decodeCommand = (value: unknown): InstanceControlCommand | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.commandId !== "string" ||
    (record.action !== "restartProcess" &&
      record.action !== "stopProcess" &&
      record.action !== "clearLogs") ||
    typeof record.createdAtMs !== "number"
  ) {
    return null;
  }
  return {
    commandId: record.commandId,
    action: record.action,
    processId: typeof record.processId === "string" ? record.processId : undefined,
    processName: typeof record.processName === "string" ? record.processName : undefined,
    createdAtMs: record.createdAtMs,
  };
};

const resolveProcessId = (runner: ProcessRunner, command: InstanceControlCommand) =>
  Effect.gen(function* () {
    if (command.processId !== undefined) return command.processId;
    if (command.processName === undefined) return null;
    const snapshot = yield* SubscriptionRef.get(runner.snapshotRef);
    return (
      snapshot.processes.find((process) => process.spec.name === command.processName)?.id ?? null
    );
  });

const runControlCommand = (runner: ProcessRunner, command: InstanceControlCommand) =>
  Effect.gen(function* () {
    switch (command.action) {
      case "clearLogs":
        return yield* runner.clearLogs;
      case "restartProcess": {
        const processId = yield* resolveProcessId(runner, command);
        if (processId !== null) yield* runner.restartProcess(processId);
        return;
      }
      case "stopProcess": {
        const processId = yield* resolveProcessId(runner, command);
        if (processId !== null) yield* runner.stopProcess(processId);
        return;
      }
    }
  });

const processControlInbox = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  runner: ProcessRunner,
  controlDirectory: string,
) =>
  Effect.gen(function* () {
    const files = yield* fs
      .readDirectory(controlDirectory)
      .pipe(Effect.catchCause(() => Effect.succeed([])));
    yield* Effect.forEach(
      files.filter((file) => file.endsWith(".json")).sort(),
      (file) => {
        const commandPath = path.join(controlDirectory, file);
        return fs.readFileString(commandPath).pipe(
          Effect.flatMap((content) =>
            Effect.try({
              try: () => JSON.parse(content) as unknown,
              catch: () => null,
            }),
          ),
          Effect.map(decodeCommand),
          Effect.flatMap((command) =>
            command === null ? Effect.void : runControlCommand(runner, command).pipe(Effect.ignore),
          ),
          Effect.andThen(fs.remove(commandPath).pipe(Effect.ignore)),
          Effect.ignore,
        );
      },
      { discard: true },
    );
  });

export const registerHeartbeat = (options: RegisterOptions) =>
  Effect.gen(function* () {
    const registry = yield* InstanceRegistry;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const startedAtMs = yield* Clock.currentTimeMillis;
    const controlDirectory = path.join(
      registry.directory,
      "control",
      registrySlug(options.instanceId),
    );
    const write = Effect.gen(function* () {
      const updatedAtMs = yield* Clock.currentTimeMillis;
      const snapshot = yield* SubscriptionRef.get(options.runner.snapshotRef);
      yield* registry.write(
        toRegisteredInstance(path, options, controlDirectory, startedAtMs, updatedAtMs, snapshot),
      );
    });

    yield* fs.makeDirectory(controlDirectory, { recursive: true }).pipe(Effect.ignore);
    yield* write;
    yield* Effect.addFinalizer(() =>
      registry
        .remove(options.instanceId)
        .pipe(
          Effect.andThen(fs.remove(controlDirectory, { recursive: true }).pipe(Effect.ignore)),
          Effect.ignore,
        ),
    );
    yield* Effect.forever(
      Effect.sleep(Duration.seconds(2)).pipe(Effect.andThen(write), Effect.ignore),
    ).pipe(Effect.forkScoped);
    yield* Effect.forever(
      Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(processControlInbox(fs, path, options.runner, controlDirectory)),
        Effect.ignore,
      ),
    ).pipe(Effect.forkScoped);
  });
