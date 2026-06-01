import { describe, expect, test } from "bun:test";
import { sanitizeAnsiForDisplay, stripAnsi } from "./text.ts";

describe("terminal control sanitizing", () => {
  test("strips non-printing terminal controls", () => {
    const noisy = "ready\x1b[<35;116;56M\x1b]10;rgb:c0c0/caca/f5f5\x07\x1bP>|tmux 3.6b\x1b\\";

    expect(stripAnsi(noisy)).toBe("ready");
  });

  test("keeps SGR styling for display while removing OSC, DCS, and mouse controls", () => {
    const noisy =
      "\x1b[33mready\x1b[0m\x1b[<35;116;56M\x1b]11;rgb:1a1a/1b1b/2626\x07\x1bP>|tmux 3.6b\x1b\\";

    expect(sanitizeAnsiForDisplay(noisy)).toBe("\x1b[33mready\x1b[0m");
    expect(stripAnsi(sanitizeAnsiForDisplay(noisy))).toBe("ready");
  });
});
