const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export const stripAnsi = (input: string) => input.replace(ansiPattern, "");

export const truncate = (input: string, width: number) => {
  if (width <= 0) return "";
  if (input.length <= width) return input;
  if (width <= 1) return input.slice(0, width);
  return `${input.slice(0, width - 1)}~`;
};

export const pad = (input: string, width: number) => truncate(input, width).padEnd(width);

export const extractPrintable = (key: {
  readonly name: string;
  readonly sequence?: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
}) => {
  if (key.ctrl || key.meta) return null;
  if (key.name === "space") return " ";
  if (key.name.length === 1) return key.name;
  const sequence = key.sequence ?? "";
  if (sequence.length > 1 && !/[\x00-\x1f\x7f]/.test(sequence)) return sequence;
  return null;
};

export const formatTime = (timestampMs: number) =>
  new Date(timestampMs).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
