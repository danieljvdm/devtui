import { TextAttributes } from "@opentui/core";
import { describe, expect, test } from "bun:test";
import { parseAnsiSegments, parseAnsiWrappedLines } from "./ansi.ts";

describe("parseAnsiSegments", () => {
  test("keeps SGR colors while exposing visible text only", () => {
    expect(parseAnsiSegments("Binding \x1b[33mD1 Database\x1b[0m local", 80)).toEqual([
      { text: "Binding " },
      { text: "D1 Database", fg: "#E5E510" },
      { text: " local" },
    ]);
  });

  test("truncates by visible text without counting escape sequences", () => {
    expect(parseAnsiSegments("env.DB \x1b[34mlocal\x1b[0m", 10)).toEqual([
      { text: "env.DB " },
      { text: "loc", fg: "#2472C8" },
    ]);
  });

  test("maps basic text attributes", () => {
    expect(parseAnsiSegments("\x1b[1;4mready\x1b[22;24m.", 80)).toEqual([
      { text: "ready", attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE },
      { text: "." },
    ]);
  });

  test("wraps long colored lines without dropping styles", () => {
    expect(parseAnsiWrappedLines("aa \x1b[33mbbccdd\x1b[0m ee", 5)).toEqual([
      [{ text: "aa " }, { text: "bb", fg: "#E5E510" }],
      [{ text: "ccdd", fg: "#E5E510" }, { text: " " }],
      [{ text: "ee" }],
    ]);
  });
});
