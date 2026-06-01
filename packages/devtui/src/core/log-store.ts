import {
  Cause,
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Ref,
  SubscriptionRef,
} from "effect";
import {
  LogStoreError,
  type LogEntry,
  type LogSeverity,
  type LogStoreConfig,
  type LogStream,
  type ProcessRuntime,
} from "./domain.ts";
import { sanitizeAnsiForDisplay, stripAnsi } from "./text.ts";

export interface LogStoreAppendInput {
  readonly process: ProcessRuntime;
  readonly stream: LogStream;
  readonly text: string;
}

export interface LogStoreQuery {
  readonly processId?: string;
  readonly severity?: LogSeverity | "all";
  readonly text?: string;
  readonly limit?: number;
  readonly cursorId?: number;
}

export interface LogStoreOptions {
  readonly maxEntries?: number;
}

export interface JsonlLogStoreOptions extends LogStoreOptions {
  readonly path: string;
}

export interface SqliteLogStoreOptions extends LogStoreOptions {
  readonly path: string;
}

export class LogStore extends Context.Service<
  LogStore,
  {
    readonly hotRef: SubscriptionRef.SubscriptionRef<readonly LogEntry[]>;
    readonly append: (input: LogStoreAppendInput) => Effect.Effect<LogEntry | null, LogStoreError>;
    readonly clear: Effect.Effect<void, LogStoreError>;
    readonly query: (query: LogStoreQuery) => Effect.Effect<readonly LogEntry[], LogStoreError>;
  }
>()("devtui/LogStore") {}

const defaultMaxEntries = 5_000;

const severityFor = (stream: LogStream, text: string): LogSeverity => {
  if (stream === "system") return "system";
  const lower = text.toLowerCase();
  if (stream === "stderr" || lower.includes("error") || lower.includes("failed")) return "error";
  if (lower.includes("warn")) return "warn";
  return "info";
};

const toReason = (cause: unknown) =>
  Cause.isCause(cause)
    ? Cause.pretty(cause)
    : cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : String(cause);

const queryLogs = (logs: readonly LogEntry[], query: LogStoreQuery) => {
  const lowerText = query.text?.trim().toLowerCase() ?? "";
  const filtered = logs.filter((log) => {
    if (query.processId && log.processId !== query.processId) return false;
    if (query.severity && query.severity !== "all" && log.severity !== query.severity) return false;
    if (query.cursorId !== undefined && log.id >= query.cursorId) return false;
    if (!lowerText) return true;
    return `${log.processName} ${log.stream} ${log.severity} ${log.text}`
      .toLowerCase()
      .includes(lowerText);
  });

  return query.limit === undefined
    ? filtered
    : filtered.slice(Math.max(0, filtered.length - query.limit));
};

const makeMemory = (options: LogStoreOptions = {}) =>
  Effect.gen(function* () {
    const maxEntries = Math.max(1, options.maxEntries ?? defaultMaxEntries);
    const hotRef = yield* SubscriptionRef.make<readonly LogEntry[]>([]);
    const idRef = yield* Ref.make(0);

    const append = (input: LogStoreAppendInput) =>
      Effect.gen(function* () {
        const rawText = input.text.trimEnd();
        const ansiText = sanitizeAnsiForDisplay(rawText);
        const cleanText = stripAnsi(ansiText);
        if (!cleanText) return null;

        const timestampMs = yield* Clock.currentTimeMillis;
        const id = yield* Ref.getAndUpdate(idRef, (current) => current + 1);
        const entry: LogEntry = {
          id,
          processId: input.process.id,
          processName: input.process.spec.name,
          stream: input.stream,
          severity: severityFor(input.stream, cleanText),
          text: cleanText,
          ansiText: ansiText === cleanText ? undefined : ansiText,
          timestampMs,
        };

        yield* SubscriptionRef.update(hotRef, (logs) => {
          const retained =
            logs.length >= maxEntries ? logs.slice(logs.length - maxEntries + 1) : logs;
          return [...retained, entry];
        });

        return entry;
      });

    return LogStore.of({
      hotRef,
      append,
      clear: SubscriptionRef.set(hotRef, []),
      query: (query) =>
        SubscriptionRef.get(hotRef).pipe(Effect.map((logs) => queryLogs(logs, query))),
    });
  });

export const layerMemory = (options: LogStoreOptions = {}): Layer.Layer<LogStore> =>
  Layer.effect(LogStore)(makeMemory(options));

export const layerJsonl = (
  options: JsonlLogStoreOptions,
): Layer.Layer<LogStore, LogStoreError, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(LogStore)(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const memory = yield* makeMemory(options);
      const directory = path.dirname(options.path);

      yield* fs
        .makeDirectory(directory, { recursive: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new LogStoreError({ operation: "prepare jsonl directory", reason: toReason(cause) }),
            ),
          ),
        );

      return LogStore.of({
        ...memory,
        append: (input) =>
          memory.append(input).pipe(
            Effect.tap((entry) =>
              entry === null
                ? Effect.void
                : fs
                    .writeFileString(options.path, `${JSON.stringify(entry)}\n`, { flag: "a" })
                    .pipe(
                      Effect.catchCause((cause) =>
                        Effect.fail(
                          new LogStoreError({
                            operation: "append jsonl",
                            reason: toReason(cause),
                          }),
                        ),
                      ),
                    ),
            ),
          ),
        clear: Effect.gen(function* () {
          yield* memory.clear;
          yield* fs
            .writeFileString(options.path, "", { flag: "w" })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new LogStoreError({ operation: "clear jsonl", reason: toReason(cause) }),
                ),
              ),
            );
        }),
      });
    }),
  );

export const layerSqlite = (options: SqliteLogStoreOptions): Layer.Layer<LogStore, LogStoreError> =>
  Layer.effect(LogStore)(
    Effect.fail(
      new LogStoreError({
        operation: "open sqlite",
        reason: `sqlite log storage is not implemented yet (${options.path})`,
      }),
    ),
  );

export const makeLayer = (
  config: LogStoreConfig | undefined,
): Layer.Layer<LogStore, LogStoreError, FileSystem.FileSystem | Path.Path> => {
  const maxEntries = config?.maxEntries;
  const storage = config?.storage ?? "memory";
  switch (storage) {
    case "memory":
      return layerMemory({ maxEntries });
    case "jsonl":
      return layerJsonl({ maxEntries, path: config?.path ?? ".devtui/logs.jsonl" });
    case "sqlite":
      return layerSqlite({ maxEntries, path: config?.path ?? ".devtui/logs.sqlite" });
  }
};
