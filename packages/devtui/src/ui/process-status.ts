import type { ProcessRuntime } from "../core/domain.ts";
import { truncate } from "../core/text.ts";
import { colors } from "../theme.ts";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const statusColor = (status: ProcessRuntime["status"]) => {
  switch (status) {
    case "running":
      return colors.green;
    case "starting":
      return colors.yellow;
    case "failed":
      return colors.red;
    case "stopped":
      return colors.violet;
    case "exited":
      return colors.red;
  }
};

// A non-zero exit reads as a crash, so surface the code inline (`exited(1)`).
export const statusLabel = (process: ProcessRuntime) =>
  process.status === "exited" && process.exitCode !== null
    ? `exited(${process.exitCode})`
    : process.status;

export const statusDot = (status: ProcessRuntime["status"]) => {
  switch (status) {
    case "running":
    case "starting":
    case "failed":
    case "stopped":
    case "exited":
      return "●";
  }
};

export const isCrashed = (process: ProcessRuntime | undefined): process is ProcessRuntime =>
  process !== undefined && (process.status === "exited" || process.status === "failed");

export const nameColumnWidth = (processes: readonly ProcessRuntime[]) => {
  const longest = processes.reduce((max, process) => Math.max(max, process.spec.name.length), 0);
  return clamp(longest, 3, 12);
};

export const leftPad = (input: string, width: number) => truncate(input, width).padStart(width);
