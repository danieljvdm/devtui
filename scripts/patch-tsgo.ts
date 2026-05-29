import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Path, Schema as S, Stream } from "effect";
import { Command as CliCommand } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

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

const resolvePaths = Effect.fn("resolvePaths")(function* () {
  const path = yield* Path.Path;
  const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
  const rootDir = path.resolve(path.dirname(scriptPath), "..");

  return {
    effectTsgoBin: path.join(rootDir, "node_modules", ".bin", "effect-tsgo"),
    rootDir,
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

  if (trimmed.length > 0) {
    console.error(trimmed);
  }

  if (exitCode !== 0) {
    return yield* new CommandError({
      command: formatted,
      exitCode,
      output: trimmed,
    });
  }
});

const patchTsgo = Effect.gen(function* () {
  const paths = yield* resolvePaths();
  yield* runCommand(paths.rootDir, paths.effectTsgoBin, ["patch"]);
});

const patchCommand = CliCommand.make("patch-tsgo", {}, () => patchTsgo).pipe(
  CliCommand.withDescription("Patch tsgo for Effect projects."),
);

const program = CliCommand.run(patchCommand, { version: "1.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
