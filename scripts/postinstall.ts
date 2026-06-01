import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Effect, Inspectable, Path, Schema as S, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

type Step = {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
  readonly label: string;
  readonly timeout: `${number} ${"millis" | "seconds" | "minutes"}`;
};

const STATUS_STREAM = process.stdout;
const IS_TTY = STATUS_STREAM.isTTY === true;
const GREEN = IS_TTY ? "\x1b[32m" : "";
const RED = IS_TTY ? "\x1b[31m" : "";
const DIM = IS_TTY ? "\x1b[90m" : "";
const RESET = IS_TTY ? "\x1b[0m" : "";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

type Status =
  | { readonly kind: "running" }
  | { readonly kind: "ok"; readonly timing: string }
  | { readonly kind: "fail"; readonly reason: string; readonly timing: string };

class CommandError extends S.TaggedErrorClass<CommandError>()("CommandError", {
  command: S.String,
  exitCode: S.Int,
  output: S.String,
}) {
  override get message() {
    return this.output.length > 0
      ? `${this.command} exited with code ${this.exitCode}: ${this.output}`
      : `${this.command} exited with code ${this.exitCode}`;
  }
}

const formatUnknown = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message || value.name || Inspectable.toStringUnknown(value);
  }
  return Inspectable.toStringUnknown(value);
};

const formatTiming = (elapsedMs: number): string => {
  const seconds = elapsedMs / 1000;
  const value = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(2);
  return `${DIM}[${value}s]${RESET}`;
};

const renderRow = (label: string, status: Status, frame: number): string => {
  switch (status.kind) {
    case "running":
      return `${DIM}${SPINNER[frame % SPINNER.length]}${RESET} ${label}`;
    case "ok":
      return `${GREEN}✓${RESET} ${label} ${status.timing}`;
    case "fail":
      return `${RED}✗${RESET} ${label} failed ${status.timing}`;
  }
};

const startProgress = (labels: ReadonlyArray<string>) => {
  const statuses: Array<Status> = labels.map(() => ({ kind: "running" }));
  let frame = 0;

  if (IS_TTY) {
    for (let i = 0; i < labels.length; i++) {
      STATUS_STREAM.write(`${renderRow(labels[i]!, statuses[i]!, 0)}\n`);
    }
  }

  const repaint = () => {
    if (!IS_TTY) {
      return;
    }
    STATUS_STREAM.write(`\x1b[${labels.length}A`);
    for (let i = 0; i < labels.length; i++) {
      STATUS_STREAM.write(`\r\x1b[2K${renderRow(labels[i]!, statuses[i]!, frame)}\n`);
    }
  };

  const timer: ReturnType<typeof setInterval> | null = IS_TTY
    ? setInterval(() => {
        frame++;
        repaint();
      }, 80)
    : null;

  return {
    setStatus(index: number, status: Status) {
      statuses[index] = status;
      if (IS_TTY) {
        repaint();
        return;
      }
      if (status.kind !== "running") {
        STATUS_STREAM.write(`${renderRow(labels[index]!, status, 0)}\n`);
      }
    },
    stop() {
      if (timer) {
        clearInterval(timer);
      }
      if (IS_TTY) {
        repaint();
      }
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i]!;
        if (status.kind === "fail") {
          STATUS_STREAM.write(`${RED}error${RESET} (${labels[i]}): ${status.reason}\n`);
        }
      }
    },
  };
};

const resolvePostinstall = Effect.fn("resolvePostinstall")(function* () {
  const path = yield* Path.Path;
  const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
  const rootDir = path.resolve(path.dirname(scriptPath), "..");
  const binDir = path.join(rootDir, "node_modules", ".bin");

  return {
    rootDir,
    steps: [
      {
        args: [path.join(rootDir, "scripts", "sync-effect-submodule.ts")],
        command: process.execPath,
        label: "Effect submodule",
        timeout: "5 minutes",
      },
      {
        args: ["config"],
        command: path.join(binDir, "vp"),
        label: "Vite+ config",
        timeout: "60 seconds",
      },
      {
        args: ["patch"],
        command: path.join(binDir, "effect-tsgo"),
        label: "Effect tsgo patch",
        timeout: "60 seconds",
      },
    ] satisfies ReadonlyArray<Step>,
  };
});

const runCommand = Effect.fn("runCommand")(function* (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
) {
  const formatted = [command, ...args].join(" ");
  const child = yield* ChildProcess.make(command, args, { cwd, stderr: "pipe", stdout: "pipe" });
  const [output, exitCode] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(child.all)),
    child.exitCode,
  ]);
  const trimmed = output.trim();

  if (exitCode !== 0) {
    return yield* new CommandError({
      command: formatted,
      exitCode,
      output: trimmed,
    });
  }
});

const postinstall = Effect.gen(function* () {
  const { rootDir, steps } = yield* resolvePostinstall();

  yield* Effect.acquireUseRelease(
    Effect.sync(() => startProgress(steps.map((step) => step.label))),
    (progress) =>
      Effect.gen(function* () {
        const failures: Array<unknown> = [];

        yield* Effect.all(
          steps.map((step, index) =>
            Effect.gen(function* () {
              const startedAt = yield* Clock.currentTimeMillis;
              const result = yield* Effect.result(
                runCommand(rootDir, step.command, step.args).pipe(Effect.timeout(step.timeout)),
              );
              const finishedAt = yield* Clock.currentTimeMillis;
              const timing = formatTiming(finishedAt - startedAt);

              if (result._tag === "Failure") {
                const reason = formatUnknown(result.failure);
                progress.setStatus(index, { kind: "fail", reason, timing });
                failures.push(result.failure);
                return;
              }

              progress.setStatus(index, { kind: "ok", timing });
            }),
          ),
          { concurrency: "unbounded" },
        );

        if (failures.length > 0) {
          return yield* Effect.fail(failures[0]);
        }
      }),
    (progress) => Effect.sync(() => progress.stop()),
  );
});

const program = postinstall.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program, { disableErrorReporting: true });
