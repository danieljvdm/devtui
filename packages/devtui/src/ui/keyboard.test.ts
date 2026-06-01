import { describe, expect, test } from "bun:test";
import type { ProcessRuntime } from "../core/domain.ts";
import {
  keyboardKeyFromInputSequence,
  reduceKeyboard,
  type KeyboardContext,
  type KeyboardKey,
} from "./keyboard.ts";
import type { UiState } from "./state.ts";

const processes: readonly ProcessRuntime[] = [
  {
    id: "api",
    spec: { name: "api", command: "bun run api" },
    status: "running",
    endpoints: [],
    pid: 1,
    startedAtMs: 1,
    endedAtMs: null,
    exitCode: null,
    lineCount: 0,
    errorCount: 0,
  },
];

const state: UiState = {
  viewId: "merged",
  focusedPane: "logs",
  filterMode: false,
  filterText: "",
  logLevel: "all",
  processPickerOpen: false,
  logAnchorId: null,
  logAnchorLineIndex: 0,
  selectedLogId: null,
  selectedLogLineIndex: 0,
};

const context: KeyboardContext = {
  canFocusProcesses: true,
  selectedLog: null,
  scroll: {
    visibleRows: [],
    startIndex: 0,
    maxStartIndex: 0,
    paneHeight: 10,
  },
};

const key = (input: Partial<KeyboardKey>): KeyboardKey => ({
  name: "",
  ctrl: false,
  meta: false,
  shift: false,
  ...input,
});

describe("reduceKeyboard pane focus", () => {
  test("supports plain horizontal arrows as pane focus fallback", () => {
    expect(reduceKeyboard(key({ name: "left" }), state, processes, context).state.focusedPane).toBe(
      "processes",
    );
    expect(
      reduceKeyboard(
        key({ name: "right" }),
        { ...state, focusedPane: "processes" },
        processes,
        context,
      ).state.focusedPane,
    ).toBe("logs");
  });

  test("supports ctrl-arrow encodings commonly forwarded by tmux", () => {
    expect(
      reduceKeyboard(key({ raw: "\x1b[1;5D" }), state, processes, context).state.focusedPane,
    ).toBe("processes");
    expect(
      reduceKeyboard(
        key({ raw: "\x1b[1;5C" }),
        { ...state, focusedPane: "processes" },
        processes,
        context,
      ).state.focusedPane,
    ).toBe("logs");
    expect(
      reduceKeyboard(key({ raw: "\x1bO5D" }), state, processes, context).state.focusedPane,
    ).toBe("processes");
    expect(
      reduceKeyboard(
        key({ raw: "\x1bO5C" }),
        { ...state, focusedPane: "processes" },
        processes,
        context,
      ).state.focusedPane,
    ).toBe("logs");
  });

  test("builds keyboard events from raw arrow sequences before OpenTUI can consume them", () => {
    const left = keyboardKeyFromInputSequence("\x1b[D");
    const right = keyboardKeyFromInputSequence("\x1b[C");
    const ctrlLeft = keyboardKeyFromInputSequence("\x1b[1;5D");
    const kittyCtrlRight = keyboardKeyFromInputSequence("\x1b[1;5:1C");

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(ctrlLeft).not.toBeNull();
    expect(kittyCtrlRight).not.toBeNull();

    expect(reduceKeyboard(left!, state, processes, context).state.focusedPane).toBe("processes");
    expect(
      reduceKeyboard(right!, { ...state, focusedPane: "processes" }, processes, context).state
        .focusedPane,
    ).toBe("logs");
    expect(reduceKeyboard(ctrlLeft!, state, processes, context).state.focusedPane).toBe(
      "processes",
    );
    expect(
      reduceKeyboard(kittyCtrlRight!, { ...state, focusedPane: "processes" }, processes, context)
        .state.focusedPane,
    ).toBe("logs");
  });

  test("supports vim pane keys when the terminal forwards them", () => {
    expect(
      reduceKeyboard(key({ name: "h", ctrl: true }), state, processes, context).state.focusedPane,
    ).toBe("processes");
    expect(
      reduceKeyboard(
        key({ name: "l", ctrl: true }),
        { ...state, focusedPane: "processes" },
        processes,
        context,
      ).state.focusedPane,
    ).toBe("logs");
  });

  test("treats forwarded ctrl-h as backspace-shaped pane-left outside filter mode", () => {
    expect(
      reduceKeyboard(key({ name: "backspace", raw: "\b" }), state, processes, context).state
        .focusedPane,
    ).toBe("processes");
  });

  test("builds keyboard events from raw ctrl pane sequences", () => {
    const ctrlH = keyboardKeyFromInputSequence("\b");
    const ctrlL = keyboardKeyFromInputSequence("\f");
    const kittyCtrlL = keyboardKeyFromInputSequence("\x1b[108;5:1u");

    expect(ctrlH).not.toBeNull();
    expect(ctrlL).not.toBeNull();
    expect(kittyCtrlL).not.toBeNull();

    expect(reduceKeyboard(ctrlH!, state, processes, context).state.focusedPane).toBe("processes");
    expect(
      reduceKeyboard(ctrlL!, { ...state, focusedPane: "processes" }, processes, context).state
        .focusedPane,
    ).toBe("logs");
    expect(
      reduceKeyboard(kittyCtrlL!, { ...state, focusedPane: "processes" }, processes, context).state
        .focusedPane,
    ).toBe("logs");
  });
});
