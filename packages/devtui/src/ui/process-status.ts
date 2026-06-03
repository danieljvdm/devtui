import type { ProcessRuntime } from "../core/domain.ts";
import { truncate } from "../core/text.ts";
import { colors } from "../theme.ts";

export const statusColor = (status: ProcessRuntime["status"]) => {
  switch (status) {
    case "running":
      return colors.green;
    case "starting":
      return colors.dim;
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

// A crash (non-zero exit / failure) swaps the filled dot for a red ✗ so the
// failed process is unmistakable; every other status keeps the ● (color carries
// the rest). Matches the design's ProcRow glyph.
export const statusDot = (status: ProcessRuntime["status"]) => {
  switch (status) {
    case "exited":
    case "failed":
      return "✗";
    case "running":
    case "starting":
    case "stopped":
      return "●";
  }
};

export const isCrashed = (process: ProcessRuntime | undefined): process is ProcessRuntime =>
  process !== undefined && (process.status === "exited" || process.status === "failed");

export const leftPad = (input: string, width: number) => truncate(input, width).padStart(width);
