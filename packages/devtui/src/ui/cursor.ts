import type { CliRenderer } from "@opentui/core";

export const hideTerminalCursor = "\x1b[?25l";
export const showTerminalCursor = "\x1b[?25h";

type CursorRenderer = Pick<CliRenderer, "setCursorPosition">;
type CursorWriter = {
  readonly write: (chunk: string) => unknown;
};

export const keepTerminalCursorHidden = (renderer: CursorRenderer, stdout: CursorWriter) => {
  renderer.setCursorPosition(0, 0, false);
  stdout.write(hideTerminalCursor);
};
