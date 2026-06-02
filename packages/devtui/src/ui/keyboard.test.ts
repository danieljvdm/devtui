import { describe, expect, test } from "bun:test";
import type { ProcessRuntime } from "../core/domain.ts";
import {
  keyboardKeyFromInputSequence,
  keyboardKeysFromInputSequence,
  reduceKeyboard,
  resolveQuitConfirmation,
  type KeyboardContext,
  type KeyboardKey,
} from "./keyboard.ts";
import type { UiState } from "./state.ts";

const processes: readonly ProcessRuntime[] = [
  {
    id: "api",
    spec: { name: "api", command: "bun run api" },
    status: "running",
    endpoints: [
      { label: "local", url: "http://localhost:5173", port: 5173, source: "detected" },
      { label: "portless", url: "https://api.example.dev", source: "portless" },
    ],
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
  searchMode: false,
  searchText: "",
  logLevel: "all",
  processPickerOpen: false,
  logAnchorId: null,
  logAnchorLineIndex: 0,
  selectedLogId: null,
  selectedLogLineIndex: 0,
  markedLogIds: [],
  visualAnchorId: null,
  visualAnchorLineIndex: 0,
  helpOpen: false,
  themeName: "system",
  themePickerOpen: false,
  themeFilterText: "",
  themeScrollIndex: 0,
};

const context: KeyboardContext = {
  canFocusProcesses: true,
  selectedLog: null,
  themePickerListHeight: 8,
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

const makeLog = (id: number) => ({
  id,
  processId: "api",
  processName: "api",
  stream: "stdout" as const,
  severity: "info" as const,
  text: `line ${id}`,
  timestampMs: id,
});

const rowsContext = (ids: readonly number[], overrides: Partial<KeyboardContext> = {}) => {
  const visibleRows = ids.map((id) => ({ log: makeLog(id), lineIndex: 0 }));
  return {
    canFocusProcesses: true,
    selectedLog: null,
    themePickerListHeight: 8,
    ...overrides,
    scroll: {
      visibleRows,
      startIndex: 0,
      maxStartIndex: Math.max(0, ids.length - 1),
      paneHeight: 10,
      ...overrides.scroll,
    },
  } satisfies KeyboardContext;
};

describe("reduceKeyboard log selection", () => {
  test("x marks the cursor entry and advances to the next entry", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "x" }),
      { ...state, selectedLogId: 1, selectedLogLineIndex: 0 },
      processes,
      ctx,
    );
    expect(result.state.markedLogIds).toEqual([1]);
    expect(result.state.selectedLogId).toBe(2);
    expect(result.command._tag).toBe("none");
  });

  test("x toggles a mark off when pressed on an already-marked entry", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "x" }),
      { ...state, markedLogIds: [1], selectedLogId: 1, selectedLogLineIndex: 0 },
      processes,
      ctx,
    );
    expect(result.state.markedLogIds).toEqual([]);
  });

  test("c copies every marked entry in row order and clears the selection", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "c" }),
      { ...state, markedLogIds: [3, 1] },
      processes,
      ctx,
    );
    expect(result.command).toMatchObject({ _tag: "copyText", logIds: [1, 3] });
    if (result.command._tag === "copyText") {
      expect(result.command.text.split("\n")).toHaveLength(2);
    }
    expect(result.state.markedLogIds).toEqual([]);
  });

  test("c copies logs as before when the log pane is focused", () => {
    const ctx = rowsContext([1]);
    const result = reduceKeyboard(
      key({ name: "c" }),
      { ...state, focusedPane: "logs", selectedLogId: 1, selectedLogLineIndex: 0 },
      processes,
      { ...ctx, selectedLog: makeLog(1) },
    );

    expect(result.command).toMatchObject({ _tag: "copyText", logIds: [1] });
  });

  test("y yanks the inclusive visual range between anchor and cursor", () => {
    const ctx = rowsContext([1, 2, 3, 4]);
    const result = reduceKeyboard(
      key({ name: "y" }),
      {
        ...state,
        visualAnchorId: 2,
        visualAnchorLineIndex: 0,
        selectedLogId: 4,
        selectedLogLineIndex: 0,
      },
      processes,
      ctx,
    );
    expect(result.command).toMatchObject({ _tag: "copyText", logIds: [2, 3, 4] });
    expect(result.state.visualAnchorId).toBeNull();
  });

  test("V enters visual mode anchored on the cursor entry", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "v", shift: true }),
      { ...state, selectedLogId: 2, selectedLogLineIndex: 0 },
      processes,
      ctx,
    );
    expect(result.state.visualAnchorId).toBe(2);
  });

  test("escape clears an active selection before any other escape behaviour", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "escape" }),
      { ...state, viewId: "api", markedLogIds: [1] },
      processes,
      ctx,
    );
    expect(result.state.markedLogIds).toEqual([]);
    expect(result.state.viewId).toBe("api");
  });

  test("x stops the focused process instead of marking when the process pane is focused", () => {
    const ctx = rowsContext([1, 2, 3]);
    const result = reduceKeyboard(
      key({ name: "x" }),
      { ...state, focusedPane: "processes", viewId: "api" },
      processes,
      ctx,
    );
    expect(result.command).toEqual({ _tag: "stopProcess", id: "api" });
  });

  test("c copies the selected process URL from the process pane with portless precedence", () => {
    const result = reduceKeyboard(
      key({ name: "c" }),
      { ...state, focusedPane: "processes", viewId: "api" },
      processes,
      context,
    );
    expect(result.command).toEqual({
      _tag: "copyText",
      text: "https://api.example.dev",
      logIds: [],
      label: "copied portless URL",
    });
  });

  test("c in the process pane reports when no process URL is available", () => {
    const processWithoutUrl = [{ ...processes[0]!, endpoints: [] }];
    const result = reduceKeyboard(
      key({ name: "c" }),
      { ...state, focusedPane: "processes", viewId: "api" },
      processWithoutUrl,
      context,
    );
    expect(result.command).toEqual({ _tag: "notify", message: "api has no URL" });
  });
});

describe("reduceKeyboard help and restart", () => {
  test("q requires confirmation while ctrl-c quits immediately", () => {
    expect(resolveQuitConfirmation(key({ name: "q" }), false)).toBe("arm");
    expect(resolveQuitConfirmation(key({ name: "q" }), true, 149)).toBe("arm");
    expect(resolveQuitConfirmation(key({ name: "q" }), true, 150)).toBe("execute");
    expect(resolveQuitConfirmation(key({ name: "c", ctrl: true }), false)).toBe("execute");
  });

  test("? opens the help overlay and esc closes it", () => {
    const opened = reduceKeyboard(key({ name: "?" }), state, processes, context);
    expect(opened.state.helpOpen).toBe(true);
    const closed = reduceKeyboard(key({ name: "escape" }), opened.state, processes, context);
    expect(closed.state.helpOpen).toBe(false);
  });

  test("raw kitty escape closes the help overlay", () => {
    const result = reduceKeyboard(
      key({ raw: "\x1b[27u", sequence: "\x1b[27u" }),
      { ...state, helpOpen: true },
      processes,
      context,
    );
    expect(result.state.helpOpen).toBe(false);
  });

  test("? also opens via shift+/ and toggles closed when already open", () => {
    const opened = reduceKeyboard(key({ name: "/", shift: true }), state, processes, context);
    expect(opened.state.helpOpen).toBe(true);
    const toggled = reduceKeyboard(key({ name: "?" }), opened.state, processes, context);
    expect(toggled.state.helpOpen).toBe(false);
  });

  test("the help overlay swallows navigation keys", () => {
    const helpState = { ...state, helpOpen: true };
    const result = reduceKeyboard(key({ name: "j" }), helpState, processes, rowsContext([1, 2, 3]));
    expect(result.state).toEqual(helpState);
    expect(result.command._tag).toBe("none");
  });

  test("shift+r restarts every process", () => {
    const result = reduceKeyboard(
      key({ name: "r", shift: true }),
      { ...state, viewId: "api" },
      processes,
      context,
    );
    expect(result.command).toEqual({ _tag: "restartAll" });
  });

  test("r restarts only the focused process", () => {
    const result = reduceKeyboard(
      key({ name: "r" }),
      { ...state, viewId: "api" },
      processes,
      context,
    );
    expect(result.command).toEqual({ _tag: "restartProcess", id: "api" });
  });

  test("t opens the theme selector", () => {
    const result = reduceKeyboard(key({ name: "t" }), state, processes, context);
    expect(result.state.themePickerOpen).toBe(true);
    expect(result.state.themeFilterText).toBe("");
    expect(result.command._tag).toBe("none");
  });

  test("/ edits search while f edits filter", () => {
    const openedSearch = reduceKeyboard(key({ name: "/" }), state, processes, context);
    expect(openedSearch.state.searchMode).toBe(true);
    expect(openedSearch.state.filterMode).toBe(false);

    const searched = reduceKeyboard(key({ name: "t" }), openedSearch.state, processes, context);
    expect(searched.state.searchText).toBe("t");

    const openedFilter = reduceKeyboard(key({ name: "f" }), state, processes, context);
    expect(openedFilter.state.filterMode).toBe(true);
    expect(openedFilter.state.searchMode).toBe(false);
  });

  test("escape peels the search first, then the filter and level", () => {
    const combined = {
      ...state,
      searchText: "tasks",
      filterText: "api",
      logLevel: "warn" as const,
    };
    const first = reduceKeyboard(key({ name: "escape" }), combined, processes, context);
    // The search runs inside the filter, so the first escape clears only the
    // search and leaves the filter (and level) intact.
    expect(first.state.searchText).toBe("");
    expect(first.state.filterText).toBe("api");
    expect(first.state.logLevel).toBe("warn");
    // A second escape then clears the filter and resets the level.
    const second = reduceKeyboard(key({ name: "escape" }), first.state, processes, context);
    expect(second.state.filterText).toBe("");
    expect(second.state.logLevel).toBe("all");
  });

  test("f inside a search filters to the hits and clears the search", () => {
    const result = reduceKeyboard(
      key({ name: "f" }),
      { ...state, searchText: "tasks" },
      processes,
      context,
    );
    expect(result.state.filterText).toBe("tasks");
    expect(result.state.searchText).toBe("");
    expect(result.state.searchMode).toBe(false);
    expect(result.state.filterMode).toBe(false);
  });

  test("theme selector previews themes with j/k and closes on enter", () => {
    const opened = { ...state, themePickerOpen: true, themeName: "system" as const };
    const moved = reduceKeyboard(key({ name: "j" }), opened, processes, context);
    expect(moved.state.themeName).toBe("tokyonight");
    expect(moved.state.themePickerOpen).toBe(true);

    const closed = reduceKeyboard(key({ name: "enter" }), moved.state, processes, context);
    expect(closed.state.themeName).toBe("tokyonight");
    expect(closed.state.themePickerOpen).toBe(false);
  });

  test("theme selector scrolls to keep the previewed theme visible", () => {
    const smallContext = { ...context, themePickerListHeight: 4 };
    const opened = { ...state, themePickerOpen: true, themeName: "one-half-dark" as const };
    const moved = reduceKeyboard(key({ name: "j" }), opened, processes, smallContext);
    expect(moved.state.themeName).toBe("rosepine");
    expect(moved.state.themeScrollIndex).toBeGreaterThan(0);
  });

  test("theme selector filters by printable input", () => {
    const opened = { ...state, themePickerOpen: true, themeName: "system" as const };
    const typedT = reduceKeyboard(key({ name: "t" }), opened, processes, context);
    const typedO = reduceKeyboard(key({ name: "o" }), typedT.state, processes, context);
    const result = reduceKeyboard(key({ name: "k" }), typedO.state, processes, context);
    expect(result.state.themeFilterText).toBe("tok");
    expect(result.state.themeName).toBe("tokyonight");
  });

  test("escape closes the theme selector and clears its query", () => {
    const result = reduceKeyboard(
      key({ name: "escape" }),
      { ...state, themePickerOpen: true, themeFilterText: "tok", themeName: "tokyonight" },
      processes,
      context,
    );
    expect(result.state.themePickerOpen).toBe(false);
    expect(result.state.themeFilterText).toBe("");
    expect(result.state.themeScrollIndex).toBe(0);
    expect(result.state.themeName).toBe("tokyonight");
  });
});

describe("keyboardKeyFromInputSequence escape", () => {
  test("recognizes a lone ESC so esc reliably reaches the reducer", () => {
    const esc = keyboardKeyFromInputSequence("\x1b");
    expect(esc).not.toBeNull();
    expect(esc!.name).toBe("escape");
  });

  test("recognizes kitty and modifyOtherKeys escape encodings", () => {
    expect(keyboardKeyFromInputSequence("\x1b[27u")?.name).toBe("escape");
    expect(keyboardKeyFromInputSequence("\x1b[27;1u")?.name).toBe("escape");
    expect(keyboardKeyFromInputSequence("\x1b[27;1;27~")?.name).toBe("escape");
  });

  test("recognizes esc coalesced with terminal responses", () => {
    expect(keyboardKeyFromInputSequence("\x1b\x1b]10;rgb:c0c0/caca/f5f5\x07")?.name).toBe("escape");
    expect(keyboardKeyFromInputSequence("\x1b\x1b[?997;1n")?.name).toBe("escape");
  });

  test("raw kitty escape cancels filter mode and clears the query", () => {
    const result = reduceKeyboard(
      key({ raw: "\x1b[27;1u", sequence: "\x1b[27;1u" }),
      { ...state, filterMode: true, filterText: "api" },
      processes,
      context,
    );
    expect(result.state.filterMode).toBe(false);
    expect(result.state.filterText).toBe("");
  });

  test("builds keyboard events from printable characters", () => {
    expect(keyboardKeyFromInputSequence("q")).toMatchObject({ name: "q", raw: "q" });
    expect(keyboardKeyFromInputSequence("?")).toMatchObject({ name: "?", raw: "?" });
  });

  test("builds keyboard events from raw tmux control sequences", () => {
    expect(keyboardKeyFromInputSequence("\r")).toMatchObject({ name: "enter" });
    expect(keyboardKeyFromInputSequence("\t")).toMatchObject({ name: "tab" });
    expect(keyboardKeyFromInputSequence("\x03")).toMatchObject({ name: "c", ctrl: true });
    expect(keyboardKeyFromInputSequence("\x0e")).toMatchObject({ name: "n", ctrl: true });
    expect(keyboardKeyFromInputSequence("\x10")).toMatchObject({ name: "p", ctrl: true });
  });

  test("splits batched printable tmux input into key events", () => {
    expect(keyboardKeysFromInputSequence("/tasks\r").map((event) => event.name)).toEqual([
      "/",
      "t",
      "a",
      "s",
      "k",
      "s",
      "enter",
    ]);
  });

  test("does not mistake an arrow sequence for escape", () => {
    expect(keyboardKeyFromInputSequence("\x1b[D")!.name).toBe("left");
  });
});

describe("reduceKeyboard search navigation", () => {
  const rows = [
    { id: 1, text: "worker: handled /api/users" },
    { id: 2, text: "worker: handled /api/tasks" }, // match (index 1)
    { id: 3, text: "worker: handled /assets/app.js" },
    { id: 4, text: "worker: handled /api/tasks again" }, // match (index 3)
    { id: 5, text: "worker: done" },
  ].map(({ id, text }) => ({
    log: {
      id,
      processId: "worker",
      processName: "worker",
      stream: "stdout" as const,
      severity: "info" as const,
      text,
      timestampMs: id,
    },
    lineIndex: 0,
  }));
  const searchContext: KeyboardContext = {
    ...context,
    scroll: { visibleRows: rows, startIndex: 0, maxStartIndex: 0, paneHeight: rows.length },
  };

  test("committing a search jumps the cursor to the first hit", () => {
    const result = reduceKeyboard(
      key({ name: "enter" }),
      { ...state, searchMode: true, searchText: "tasks" },
      processes,
      searchContext,
    );
    expect(result.state.searchMode).toBe(false);
    expect(result.state.selectedLogId).toBe(2);
  });

  test("n / N step forward and back through hits, wrapping at the ends", () => {
    const onFirst = { ...state, searchText: "tasks", selectedLogId: 2, selectedLogLineIndex: 0 };
    const next = reduceKeyboard(key({ name: "n" }), onFirst, processes, searchContext);
    expect(next.state.selectedLogId).toBe(4);

    const prev = reduceKeyboard(
      key({ name: "N", shift: true }),
      next.state,
      processes,
      searchContext,
    );
    expect(prev.state.selectedLogId).toBe(2);

    // n from the last hit wraps back to the first
    const wrapped = reduceKeyboard(
      key({ name: "n" }),
      { ...state, searchText: "tasks", selectedLogId: 4, selectedLogLineIndex: 0 },
      processes,
      searchContext,
    );
    expect(wrapped.state.selectedLogId).toBe(2);
  });
});
