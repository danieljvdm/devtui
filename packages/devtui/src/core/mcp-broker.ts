import { Clock, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import { AiError, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import type { LogEntry, LogSeverity } from "./domain.ts";
import { InstanceRegistry, type RegisteredInstance } from "./instance-registry.ts";

const activeWindowMs = 10_000;

const LogLevelSchema = Schema.Literals(["all", "error", "warn", "info", "system"]);

const BrokerEndpointSchema = Schema.Struct({
  label: Schema.String,
  url: Schema.String,
  port: Schema.optional(Schema.Number),
  source: Schema.Literals(["detected", "portless", "log", "config"]),
});

const BrokerProcessSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  endpoints: Schema.Array(BrokerEndpointSchema),
  pid: Schema.NullOr(Schema.Number),
  lineCount: Schema.Number,
  errorCount: Schema.Number,
});

const BrokerInstanceSchema = Schema.Struct({
  instanceId: Schema.String,
  title: Schema.String,
  cwd: Schema.String,
  mode: Schema.Literals(["tui", "mcp"]),
  pid: Schema.NullOr(Schema.Number),
  startedAtMs: Schema.Number,
  updatedAtMs: Schema.Number,
  ageMs: Schema.Number,
  active: Schema.Boolean,
  storage: Schema.String,
  logPath: Schema.NullOr(Schema.String),
  controlDirectory: Schema.String,
  processCount: Schema.Number,
  logCount: Schema.Number,
  processes: Schema.Array(BrokerProcessSchema),
});

const BrokerLogSchema = Schema.Struct({
  id: Schema.Number,
  processId: Schema.String,
  processName: Schema.String,
  stream: Schema.Literals(["stdout", "stderr", "system"]),
  severity: Schema.Literals(["info", "warn", "error", "system"]),
  text: Schema.String,
  timestampMs: Schema.Number,
});

const InstanceTargetSchema = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});

const BrokerLogsQuerySchema = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  processId: Schema.optional(Schema.String),
  processName: Schema.optional(Schema.String),
  level: Schema.optional(LogLevelSchema),
  text: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  beforeId: Schema.optional(Schema.Number),
});

const BrokerProcessTargetSchema = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  processId: Schema.optional(Schema.String),
  processName: Schema.optional(Schema.String),
});

const InstancesTool = Tool.make("devtui_instances", {
  description:
    "List running devtui instances registered on this machine. Call this before choosing an instance.",
  success: Schema.Struct({
    registryDir: Schema.String,
    instances: Schema.Array(BrokerInstanceSchema),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const SelectInstanceTool = Tool.make("devtui_select_instance", {
  description: "Select a devtui instance for subsequent broker tools by instanceId or cwd.",
  parameters: InstanceTargetSchema,
  success: Schema.Struct({
    selected: BrokerInstanceSchema,
  }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const SelectedInstanceTool = Tool.make("devtui_selected_instance", {
  description: "Return the currently selected broker instance, if one has been selected.",
  success: Schema.Struct({
    selected: Schema.NullOr(BrokerInstanceSchema),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const BrokerLogsTool = Tool.make("devtui_broker_logs", {
  description:
    "Query logs for the selected or targeted devtui instance. JSONL-backed instances can be queried from the broker.",
  parameters: BrokerLogsQuerySchema,
  success: Schema.Struct({
    instanceId: Schema.String,
    logPath: Schema.NullOr(Schema.String),
    unavailable: Schema.NullOr(Schema.String),
    logs: Schema.Array(BrokerLogSchema),
    count: Schema.Number,
    oldestId: Schema.NullOr(Schema.Number),
    newestId: Schema.NullOr(Schema.Number),
    nextBeforeId: Schema.NullOr(Schema.Number),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const BrokerRestartProcessTool = Tool.make("devtui_broker_restart_process", {
  description: "Ask a selected or targeted devtui instance to restart a process by id or name.",
  parameters: BrokerProcessTargetSchema,
  success: Schema.Struct({
    instanceId: Schema.String,
    commandId: Schema.String,
    accepted: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const BrokerStopProcessTool = Tool.make("devtui_broker_stop_process", {
  description: "Ask a selected or targeted devtui instance to stop a process by id or name.",
  parameters: BrokerProcessTargetSchema,
  success: Schema.Struct({
    instanceId: Schema.String,
    commandId: Schema.String,
    accepted: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const BrokerClearLogsTool = Tool.make("devtui_broker_clear_logs", {
  description: "Ask a selected or targeted devtui instance to clear its logs.",
  parameters: InstanceTargetSchema,
  success: Schema.Struct({
    instanceId: Schema.String,
    commandId: Schema.String,
    accepted: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const BrokerToolkit = Toolkit.make(
  InstancesTool,
  SelectInstanceTool,
  SelectedInstanceTool,
  BrokerLogsTool,
  BrokerRestartProcessTool,
  BrokerStopProcessTool,
  BrokerClearLogsTool,
);

const toolError = (method: string, reason: string) =>
  AiError.make({
    module: "devtui-broker",
    method,
    reason: new AiError.UnknownError({ description: reason }),
  });

const toBrokerInstance = (
  nowMs: number,
  instance: RegisteredInstance,
): typeof BrokerInstanceSchema.Type => {
  const ageMs = Math.max(0, nowMs - instance.updatedAtMs);
  return {
    ...instance,
    ageMs,
    active: ageMs <= activeWindowMs,
    processes: [...instance.processes],
  };
};

const listBrokerInstances = (registry: typeof InstanceRegistry.Service) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const instances = yield* registry.list.pipe(
      Effect.mapError((error) => toolError("devtui_instances", error.message)),
    );
    return instances.map((instance) => toBrokerInstance(nowMs, instance));
  });

const resolveInstance = (
  registry: typeof InstanceRegistry.Service,
  selectedRef: Ref.Ref<string | null>,
  params: typeof InstanceTargetSchema.Type,
) =>
  Effect.gen(function* () {
    const instances = yield* listBrokerInstances(registry);
    const selected = yield* Ref.get(selectedRef);
    const instance = params.instanceId
      ? instances.find((candidate) => candidate.instanceId === params.instanceId)
      : params.cwd
        ? instances.find((candidate) => candidate.cwd === params.cwd)
        : selected
          ? instances.find((candidate) => candidate.instanceId === selected)
          : instances.length === 1
            ? instances[0]
            : null;

    if (!instance) {
      return yield* Effect.fail(
        toolError(
          "resolve_instance",
          "instance not found; call devtui_instances and pass instanceId or cwd",
        ),
      );
    }

    return instance;
  });

const enqueueCommand = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  commandSequenceRef: Ref.Ref<number>,
  instance: typeof BrokerInstanceSchema.Type,
  command: {
    readonly action: "restartProcess" | "stopProcess" | "clearLogs";
    readonly processId?: string;
    readonly processName?: string;
  },
) =>
  Effect.gen(function* () {
    const createdAtMs = yield* Clock.currentTimeMillis;
    const sequence = yield* Ref.getAndUpdate(commandSequenceRef, (current) => current + 1);
    const commandId = `${createdAtMs}-${sequence}`;
    yield* fs
      .makeDirectory(instance.controlDirectory, { recursive: true })
      .pipe(Effect.mapError((error) => toolError("enqueue_command", error.message)));
    yield* fs
      .writeFileString(
        path.join(instance.controlDirectory, `${commandId}.json`),
        `${JSON.stringify({ commandId, createdAtMs, ...command }, null, 2)}\n`,
      )
      .pipe(Effect.mapError((error) => toolError("enqueue_command", error.message)));
    return {
      instanceId: instance.instanceId,
      commandId,
      accepted: true,
    };
  });

const decodeLogEntry = (value: unknown): LogEntry | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "number" ||
    typeof record.processId !== "string" ||
    typeof record.processName !== "string" ||
    (record.stream !== "stdout" && record.stream !== "stderr" && record.stream !== "system") ||
    (record.severity !== "info" &&
      record.severity !== "warn" &&
      record.severity !== "error" &&
      record.severity !== "system") ||
    typeof record.text !== "string" ||
    typeof record.timestampMs !== "number"
  ) {
    return null;
  }
  return {
    id: record.id,
    processId: record.processId,
    processName: record.processName,
    stream: record.stream,
    severity: record.severity,
    text: record.text,
    ansiText: typeof record.ansiText === "string" ? record.ansiText : undefined,
    timestampMs: record.timestampMs,
  };
};

const queryLogs = (logs: readonly LogEntry[], params: typeof BrokerLogsQuerySchema.Type) => {
  const lowerText = params.text?.trim().toLowerCase() ?? "";
  const severity: LogSeverity | "all" = params.level ?? "all";
  const filtered = logs.filter((log) => {
    if (params.processId && log.processId !== params.processId) return false;
    if (params.processName && log.processName !== params.processName) return false;
    if (severity !== "all" && log.severity !== severity) return false;
    if (params.beforeId !== undefined && log.id >= params.beforeId) return false;
    if (!lowerText) return true;
    return `${log.processName} ${log.stream} ${log.severity} ${log.text}`
      .toLowerCase()
      .includes(lowerText);
  });
  const limit = Math.max(1, Math.min(1_000, Math.floor(params.limit ?? 200)));
  return filtered.slice(Math.max(0, filtered.length - limit));
};

const readJsonlLogs = (fs: FileSystem.FileSystem, path: string) =>
  Effect.gen(function* () {
    const content = yield* fs
      .readFileString(path)
      .pipe(Effect.mapError((error) => toolError("devtui_broker_logs", error.message)));
    return yield* Effect.forEach(
      content.split(/\r?\n/).filter((line) => line.trim().length > 0),
      (line) =>
        Effect.try({
          try: () => JSON.parse(line) as unknown,
          catch: (cause) => toolError("devtui_broker_logs", String(cause)),
        }).pipe(Effect.map(decodeLogEntry)),
    ).pipe(Effect.map((logs) => logs.filter((log): log is LogEntry => log !== null)));
  });

export const layerHandlers = () =>
  BrokerToolkit.toLayer(
    Effect.gen(function* () {
      const registry = yield* InstanceRegistry;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const selectedRef = yield* Ref.make<string | null>(null);
      const commandSequenceRef = yield* Ref.make(0);

      return BrokerToolkit.of({
        devtui_instances: () =>
          listBrokerInstances(registry).pipe(
            Effect.map((instances) => ({
              registryDir: registry.directory,
              instances,
            })),
          ),
        devtui_select_instance: (params) =>
          Effect.gen(function* () {
            const selected = yield* resolveInstance(registry, selectedRef, params);
            yield* Ref.set(selectedRef, selected.instanceId);
            return { selected };
          }),
        devtui_selected_instance: () =>
          Effect.gen(function* () {
            const selected = yield* Ref.get(selectedRef);
            if (!selected) return { selected: null };
            const instances = yield* listBrokerInstances(registry);
            return {
              selected: instances.find((instance) => instance.instanceId === selected) ?? null,
            };
          }),
        devtui_broker_logs: (params) =>
          Effect.gen(function* () {
            const instance = yield* resolveInstance(registry, selectedRef, params);
            if (!instance.logPath) {
              return {
                instanceId: instance.instanceId,
                logPath: null,
                unavailable: `instance uses ${instance.storage} storage; broker log queries require jsonl storage`,
                logs: [],
                count: 0,
                oldestId: null,
                newestId: null,
                nextBeforeId: null,
              };
            }
            const logs = queryLogs(yield* readJsonlLogs(fs, instance.logPath), params);
            const oldestId = logs[0]?.id ?? null;
            const newestId = logs[logs.length - 1]?.id ?? null;
            return {
              instanceId: instance.instanceId,
              logPath: instance.logPath,
              unavailable: null,
              logs,
              count: logs.length,
              oldestId,
              newestId,
              nextBeforeId: oldestId,
            };
          }),
        devtui_broker_restart_process: (params) =>
          Effect.gen(function* () {
            const instance = yield* resolveInstance(registry, selectedRef, params);
            return yield* enqueueCommand(fs, path, commandSequenceRef, instance, {
              action: "restartProcess",
              processId: params.processId,
              processName: params.processName,
            });
          }),
        devtui_broker_stop_process: (params) =>
          Effect.gen(function* () {
            const instance = yield* resolveInstance(registry, selectedRef, params);
            return yield* enqueueCommand(fs, path, commandSequenceRef, instance, {
              action: "stopProcess",
              processId: params.processId,
              processName: params.processName,
            });
          }),
        devtui_broker_clear_logs: (params) =>
          Effect.gen(function* () {
            const instance = yield* resolveInstance(registry, selectedRef, params);
            return yield* enqueueCommand(fs, path, commandSequenceRef, instance, {
              action: "clearLogs",
            });
          }),
      });
    }),
  );

export const layerStdio = (options: { readonly version: string }) =>
  McpServer.toolkit(BrokerToolkit).pipe(
    Layer.provideMerge(layerHandlers()),
    Layer.provide(
      McpServer.layerStdio({
        name: "devtui-broker",
        version: options.version,
      }),
    ),
  );
