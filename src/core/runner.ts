import { Cause, Clock, Effect, Fiber, Ref, Scope, Stream, SubscriptionRef } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import type { BunServices } from "@effect/platform-bun/BunServices";
import type * as Context from "effect/Context";
import {
  type DevtuiConfig,
  type LogStoreError,
  type LogStream,
  type PlanDiagnostic,
  type ProcessRuntime,
  type ProcessSpec,
  type RunnerSnapshot,
  type RunningProcess,
} from "./domain.ts";
import { LogStore } from "./log-store.ts";

export interface ProcessRunner {
  readonly snapshotRef: SubscriptionRef.SubscriptionRef<RunnerSnapshot>;
  readonly startAll: Effect.Effect<void, LogStoreError>;
  readonly stopAll: Effect.Effect<void, LogStoreError>;
  readonly stopProcess: (id: string) => Effect.Effect<void, LogStoreError>;
  readonly restartProcess: (id: string) => Effect.Effect<void, LogStoreError>;
  readonly clearLogs: Effect.Effect<void, LogStoreError>;
}

export interface ProcessRunnerOptions {
  readonly startupDiagnostics?: readonly PlanDiagnostic[];
}

const makeProcessId = (name: string, index: number) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "process"}-${index + 1}`;
};

const initialRuntime = (spec: ProcessSpec, index: number): ProcessRuntime => ({
  id: makeProcessId(spec.name, index),
  spec,
  status: "starting",
  endpoints: spec.endpoints ?? [],
  pid: null,
  startedAtMs: null,
  endedAtMs: null,
  exitCode: null,
  lineCount: 0,
  errorCount: 0,
});

const updateProcess = (
  snapshotRef: SubscriptionRef.SubscriptionRef<RunnerSnapshot>,
  id: string,
  f: (process: ProcessRuntime) => ProcessRuntime,
) =>
  SubscriptionRef.update(snapshotRef, (snapshot) => ({
    ...snapshot,
    processes: snapshot.processes.map((process) => (process.id === id ? f(process) : process)),
  }));

const appendLog = (
  snapshotRef: SubscriptionRef.SubscriptionRef<RunnerSnapshot>,
  logStore: typeof LogStore.Service,
  process: ProcessRuntime,
  stream: LogStream,
  text: string,
) =>
  Effect.gen(function* () {
    const entry = yield* logStore.append({ process, stream, text });
    if (!entry) return;
    const logs = yield* SubscriptionRef.get(logStore.hotRef);

    yield* SubscriptionRef.update(snapshotRef, (snapshot) => {
      return {
        ...snapshot,
        logs,
        processes: snapshot.processes.map((candidate) =>
          candidate.id === process.id
            ? {
                ...candidate,
                lineCount: candidate.lineCount + 1,
                errorCount:
                  entry.severity === "error" ? candidate.errorCount + 1 : candidate.errorCount,
              }
            : candidate,
        ),
      };
    });
  });

const markNotRunning = (
  runningRef: Ref.Ref<Map<string, RunningProcess>>,
  id: string,
  runId: number,
) =>
  Ref.update(runningRef, (running) => {
    const current = running.get(id);
    if (!current || current.runId !== runId) return running;
    const next = new Map(running);
    next.delete(id);
    return next;
  });

export const makeProcessRunner = (
  config: DevtuiConfig,
  scope: Scope.Scope,
  context: Context.Context<BunServices>,
  options: ProcessRunnerOptions = {},
): Effect.Effect<ProcessRunner, never, LogStore> =>
  Effect.gen(function* () {
    const initialProcesses = config.processes.map(initialRuntime);
    const logStore = yield* LogStore;
    const snapshotRef = yield* SubscriptionRef.make<RunnerSnapshot>({
      processes: initialProcesses,
      logs: yield* SubscriptionRef.get(logStore.hotRef),
    });
    const runningRef = yield* Ref.make(new Map<string, RunningProcess>());
    const runIdRef = yield* Ref.make(0);
    const systemProcess: ProcessRuntime = {
      id: "devtui-system",
      spec: { name: "devtui", command: "devtui" },
      status: "running",
      endpoints: [],
      pid: null,
      startedAtMs: null,
      endedAtMs: null,
      exitCode: null,
      lineCount: 0,
      errorCount: 0,
    };

    yield* Effect.forEach(
      options.startupDiagnostics ?? [],
      (diagnostic) =>
        appendLog(
          snapshotRef,
          logStore,
          systemProcess,
          "system",
          `${diagnostic.level}: ${diagnostic.message}`,
        ),
      { discard: true },
    ).pipe(Effect.catchCause(() => Effect.void));

    const setRunning = (id: string, runningProcess: RunningProcess) =>
      Ref.update(runningRef, (running) => {
        const next = new Map(running);
        next.set(id, runningProcess);
        return next;
      });

    const processById = (id: string) =>
      SubscriptionRef.get(snapshotRef).pipe(
        Effect.map((snapshot) => snapshot.processes.find((process) => process.id === id) ?? null),
      );

    const consumeStream = (
      process: ProcessRuntime,
      streamName: LogStream,
      stream: Stream.Stream<Uint8Array, unknown>,
    ) =>
      stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => appendLog(snapshotRef, logStore, process, streamName, line)),
        Effect.catchCause((cause) =>
          appendLog(
            snapshotRef,
            logStore,
            process,
            "system",
            `stream failed: ${Cause.pretty(cause)}`,
          ),
        ),
      );

    const runProcess = (
      process: ProcessRuntime,
      runId: number,
    ): Effect.Effect<void, LogStoreError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const startedAtMs = yield* Clock.currentTimeMillis;
          yield* updateProcess(snapshotRef, process.id, (current) => ({
            ...current,
            status: "starting",
            pid: null,
            startedAtMs,
            endedAtMs: null,
            exitCode: null,
          }));
          yield* appendLog(
            snapshotRef,
            logStore,
            process,
            "system",
            `starting: ${process.spec.command}`,
          );

          const handle = (yield* ChildProcess.make(process.spec.command, {
            cwd: process.spec.cwd,
            env: process.spec.env ? { ...process.spec.env } : undefined,
            extendEnv: true,
            shell: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          })) as ChildProcessHandle;

          yield* Ref.update(runningRef, (running) => {
            const current = running.get(process.id);
            if (!current || current.runId !== runId) return running;
            const next = new Map(running);
            next.set(process.id, { ...current, handle });
            return next;
          });
          yield* updateProcess(snapshotRef, process.id, (current) => ({
            ...current,
            status: "running",
            pid: Number(handle.pid),
          }));

          yield* consumeStream(process, "stdout", handle.stdout).pipe(Effect.forkScoped);
          yield* consumeStream(process, "stderr", handle.stderr).pipe(Effect.forkScoped);

          const exitCode = yield* handle.exitCode;
          const endedAtMs = yield* Clock.currentTimeMillis;
          yield* markNotRunning(runningRef, process.id, runId);
          yield* updateProcess(snapshotRef, process.id, (current) => ({
            ...current,
            status: Number(exitCode) === 0 ? "exited" : "failed",
            endedAtMs,
            exitCode: Number(exitCode),
          }));
          yield* appendLog(
            snapshotRef,
            logStore,
            process,
            "system",
            `exited with code ${Number(exitCode)}`,
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const endedAtMs = yield* Clock.currentTimeMillis;
              yield* markNotRunning(runningRef, process.id, runId);
              yield* updateProcess(snapshotRef, process.id, (current) => ({
                ...current,
                status: "failed",
                endedAtMs,
              }));
              yield* appendLog(
                snapshotRef,
                logStore,
                process,
                "system",
                `failed: ${Cause.pretty(cause)}`,
              );
            }),
          ),
        ),
      ).pipe(Effect.provideContext(context));

    const startProcess = (process: ProcessRuntime) =>
      Effect.gen(function* () {
        const runId = yield* Ref.getAndUpdate(runIdRef, (current) => current + 1);
        const fiber = yield* runProcess(process, runId).pipe(Effect.forkIn(scope));
        yield* setRunning(process.id, { runId, fiber, handle: null });
      });

    const stopProcess = (id: string) =>
      Effect.gen(function* () {
        const process = yield* processById(id);
        if (!process) return;
        const running = (yield* Ref.get(runningRef)).get(id);
        if (!running) return;

        yield* appendLog(snapshotRef, logStore, process, "system", "stopping");
        if (running.handle) {
          yield* running.handle
            .kill()
            .pipe(
              Effect.catchCause((cause) =>
                appendLog(
                  snapshotRef,
                  logStore,
                  process,
                  "system",
                  `stop failed: ${Cause.pretty(cause)}`,
                ),
              ),
            );
        }
        yield* Fiber.interrupt(running.fiber);
        yield* Ref.update(runningRef, (current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        const endedAtMs = yield* Clock.currentTimeMillis;
        yield* updateProcess(snapshotRef, id, (current) => ({
          ...current,
          status: "stopped",
          endedAtMs,
        }));
      }).pipe(Effect.provideContext(context));

    const restartProcess = (id: string) =>
      Effect.gen(function* () {
        yield* stopProcess(id);
        const process = yield* processById(id);
        if (process) yield* startProcess(process);
      });

    const stopAll = Effect.gen(function* () {
      const ids = Array.from((yield* Ref.get(runningRef)).keys());
      yield* Effect.forEach(ids, stopProcess, { concurrency: "unbounded", discard: true });
    });

    const clearLogs = Effect.gen(function* () {
      yield* logStore.clear;
      const logs = yield* SubscriptionRef.get(logStore.hotRef);
      yield* SubscriptionRef.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        logs,
        processes: snapshot.processes.map((process) => ({
          ...process,
          lineCount: 0,
          errorCount: 0,
        })),
      }));
    });

    const startAll = SubscriptionRef.get(snapshotRef).pipe(
      Effect.flatMap((snapshot) =>
        Effect.forEach(snapshot.processes, startProcess, {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    );

    return {
      snapshotRef,
      startAll,
      stopAll,
      stopProcess,
      restartProcess,
      clearLogs,
    };
  });
