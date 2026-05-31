import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { AiError, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import type { DevtuiConfig, LogEntry, LogSeverity, ProcessRuntime } from "./domain.ts";
import { LogStore } from "./log-store.ts";
import type { ProcessRunner } from "./runner.ts";

const LogLevelSchema = Schema.Literals(["all", "error", "warn", "info", "system"]);
const ProcessStatusSchema = Schema.Literals(["starting", "running", "exited", "failed", "stopped"]);

const McpEndpointSchema = Schema.Struct({
  label: Schema.String,
  url: Schema.String,
  port: Schema.optional(Schema.Number),
  source: Schema.Literals(["detected", "portless", "log", "config"]),
});

const McpProcessSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  status: ProcessStatusSchema,
  endpoints: Schema.Array(McpEndpointSchema),
  pid: Schema.NullOr(Schema.Number),
  startedAtMs: Schema.NullOr(Schema.Number),
  endedAtMs: Schema.NullOr(Schema.Number),
  exitCode: Schema.NullOr(Schema.Number),
  lineCount: Schema.Number,
  errorCount: Schema.Number,
});

const McpLogSchema = Schema.Struct({
  id: Schema.Number,
  processId: Schema.String,
  processName: Schema.String,
  stream: Schema.Literals(["stdout", "stderr", "system"]),
  severity: Schema.Literals(["info", "warn", "error", "system"]),
  text: Schema.String,
  timestampMs: Schema.Number,
});

const LogsQuerySchema = Schema.Struct({
  processId: Schema.optional(Schema.String),
  processName: Schema.optional(Schema.String),
  level: Schema.optional(LogLevelSchema),
  text: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  beforeId: Schema.optional(Schema.Number),
});

const ProcessTargetSchema = Schema.Struct({
  processId: Schema.optional(Schema.String),
  processName: Schema.optional(Schema.String),
});

const StatusTool = Tool.make("devtui_status", {
  description: "Return this devtui MCP server instance, process summary, and log buffer status.",
  success: Schema.Struct({
    instanceId: Schema.String,
    title: Schema.String,
    cwd: Schema.String,
    storage: Schema.String,
    processCount: Schema.Number,
    logCount: Schema.Number,
    processes: Schema.Array(McpProcessSchema),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const ProcessesTool = Tool.make("devtui_processes", {
  description: "List processes managed by this devtui instance.",
  success: Schema.Struct({
    processes: Schema.Array(McpProcessSchema),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const LogsTool = Tool.make("devtui_logs", {
  description:
    "Query logs for this devtui instance. Use beforeId to page backward through older logs.",
  parameters: LogsQuerySchema,
  success: Schema.Struct({
    logs: Schema.Array(McpLogSchema),
    count: Schema.Number,
    oldestId: Schema.NullOr(Schema.Number),
    newestId: Schema.NullOr(Schema.Number),
    nextBeforeId: Schema.NullOr(Schema.Number),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const RestartProcessTool = Tool.make("devtui_restart_process", {
  description: "Restart one managed process by id or name.",
  parameters: ProcessTargetSchema,
  success: Schema.Struct({
    process: McpProcessSchema,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const StopProcessTool = Tool.make("devtui_stop_process", {
  description: "Stop one managed process by id or name.",
  parameters: ProcessTargetSchema,
  success: Schema.Struct({
    process: McpProcessSchema,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const ClearLogsTool = Tool.make("devtui_clear_logs", {
  description: "Clear the current devtui log buffer.",
  success: Schema.Struct({
    cleared: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

const DevtuiToolkit = Toolkit.make(
  StatusTool,
  ProcessesTool,
  LogsTool,
  RestartProcessTool,
  StopProcessTool,
  ClearLogsTool,
);

export interface DevtuiMcpOptions {
  readonly config: DevtuiConfig;
  readonly runner: ProcessRunner;
  readonly cwd: string;
  readonly instanceId: string;
  readonly version: string;
}

const toMcpProcess = (process: ProcessRuntime): typeof McpProcessSchema.Type => ({
  id: process.id,
  name: process.spec.name,
  command: process.spec.command,
  cwd: process.spec.cwd ?? null,
  status: process.status,
  endpoints: [...process.endpoints],
  pid: process.pid,
  startedAtMs: process.startedAtMs,
  endedAtMs: process.endedAtMs,
  exitCode: process.exitCode,
  lineCount: process.lineCount,
  errorCount: process.errorCount,
});

const toMcpLog = (log: LogEntry): typeof McpLogSchema.Type => ({
  id: log.id,
  processId: log.processId,
  processName: log.processName,
  stream: log.stream,
  severity: log.severity,
  text: log.text,
  timestampMs: log.timestampMs,
});

const storageLabel = (config: DevtuiConfig) => config.logs?.storage ?? "memory";

const snapshot = (runner: ProcessRunner) => SubscriptionRef.get(runner.snapshotRef);

const resolveProcess = (runner: ProcessRunner, params: typeof ProcessTargetSchema.Type) =>
  Effect.gen(function* () {
    const current = yield* snapshot(runner);
    const process = current.processes.find((candidate) =>
      params.processId !== undefined
        ? candidate.id === params.processId
        : params.processName !== undefined
          ? candidate.spec.name === params.processName
          : false,
    );

    if (!process) return yield* Effect.fail(toolError("resolve_process", "process not found"));

    return process;
  });

const logLevel = (level: typeof LogLevelSchema.Type | undefined): LogSeverity | "all" =>
  level === undefined ? "all" : level;

const toolError = (method: string, reason: string) =>
  AiError.make({
    module: "devtui",
    method,
    reason: new AiError.UnknownError({ description: reason }),
  });

export const layerHandlers = (options: DevtuiMcpOptions) =>
  DevtuiToolkit.toLayer(
    Effect.gen(function* () {
      const logStore = yield* LogStore;

      return DevtuiToolkit.of({
        devtui_status: () =>
          Effect.gen(function* () {
            const current = yield* snapshot(options.runner);
            const logs = yield* SubscriptionRef.get(logStore.hotRef);
            return {
              instanceId: options.instanceId,
              title: options.config.title ?? "devtui",
              cwd: options.cwd,
              storage: storageLabel(options.config),
              processCount: current.processes.length,
              logCount: logs.length,
              processes: current.processes.map(toMcpProcess),
            };
          }),
        devtui_processes: () =>
          snapshot(options.runner).pipe(
            Effect.map((current) => ({
              processes: current.processes.map(toMcpProcess),
            })),
          ),
        devtui_logs: (params) =>
          Effect.gen(function* () {
            const current = yield* snapshot(options.runner);
            const processId =
              params.processId ??
              current.processes.find((process) => process.spec.name === params.processName)?.id;
            const limit = Math.max(1, Math.min(1_000, Math.floor(params.limit ?? 200)));
            const logs = yield* logStore
              .query({
                processId,
                severity: logLevel(params.level),
                text: params.text,
                limit,
                cursorId: params.beforeId,
              })
              .pipe(Effect.mapError((error) => toolError("devtui_logs", error.message)));
            const oldestId = logs[0]?.id ?? null;
            const newestId = logs[logs.length - 1]?.id ?? null;

            return {
              logs: logs.map(toMcpLog),
              count: logs.length,
              oldestId,
              newestId,
              nextBeforeId: oldestId,
            };
          }),
        devtui_restart_process: (params) =>
          Effect.gen(function* () {
            const process = yield* resolveProcess(options.runner, params);
            yield* options.runner
              .restartProcess(process.id)
              .pipe(Effect.mapError((error) => toolError("devtui_restart_process", error.message)));
            const updated = yield* resolveProcess(options.runner, { processId: process.id });
            return { process: toMcpProcess(updated) };
          }),
        devtui_stop_process: (params) =>
          Effect.gen(function* () {
            const process = yield* resolveProcess(options.runner, params);
            yield* options.runner
              .stopProcess(process.id)
              .pipe(Effect.mapError((error) => toolError("devtui_stop_process", error.message)));
            const updated = yield* resolveProcess(options.runner, { processId: process.id });
            return { process: toMcpProcess(updated) };
          }),
        devtui_clear_logs: () =>
          options.runner.clearLogs.pipe(
            Effect.mapError((error) => toolError("devtui_clear_logs", error.message)),
            Effect.as({ cleared: true }),
          ),
      });
    }),
  );

export const layerStdio = (options: DevtuiMcpOptions) =>
  McpServer.toolkit(DevtuiToolkit).pipe(
    Layer.provideMerge(layerHandlers(options)),
    Layer.provide(
      McpServer.layerStdio({
        name: "devtui",
        version: options.version,
      }),
    ),
  );
