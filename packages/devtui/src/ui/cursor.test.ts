import { describe, expect, test } from "bun:test";
import { hideTerminalCursor, keepTerminalCursorHidden } from "./cursor.ts";

describe("terminal cursor guard", () => {
  test("hides the native cursor through renderer state and terminal escape", () => {
    const calls: unknown[] = [];
    const renderer = {
      setCursorPosition: (...args: unknown[]) => calls.push(["cursor", ...args]),
    };
    const stdout = {
      write: (chunk: string) => calls.push(["write", chunk]),
    };

    keepTerminalCursorHidden(renderer, stdout);

    expect(calls).toEqual([
      ["cursor", 0, 0, false],
      ["write", hideTerminalCursor],
    ]);
  });
});
