import { bestProcessEndpoint, type LogEntry, type ProcessRuntime } from "../core/domain.ts";
import { extractPrintable } from "../core/text.ts";
import { themeNamesMatching } from "../theme.ts";
import { logMatchesQuery, resolveSelectedLogIds } from "./model.ts";
import type { LogLevelFilter, UiState, ViewId } from "./state.ts";

export interface KeyboardKey {
  readonly name: string;
  readonly sequence?: string;
  readonly raw?: string;
  readonly code?: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift?: boolean;
  readonly super?: boolean;
  readonly hyper?: boolean;
  readonly repeated?: boolean;
}

export type UiCommand =
  | { readonly _tag: "none" }
  | { readonly _tag: "quit" }
  | { readonly _tag: "clearLogs" }
  | {
      readonly _tag: "copyText";
      readonly text: string;
      readonly logIds: readonly number[];
      readonly label?: string;
    }
  | { readonly _tag: "notify"; readonly message: string }
  | { readonly _tag: "stopProcess"; readonly id: string }
  | { readonly _tag: "restartProcess"; readonly id: string }
  | { readonly _tag: "restartAll" };

export interface KeyboardResult {
  readonly state: UiState;
  readonly command: UiCommand;
}

export type QuitConfirmationAction = "arm" | "execute";

export const minimumQuitConfirmationAgeMs = 150;

export const resolveQuitConfirmation = (
  key: KeyboardKey,
  quitArmed: boolean,
  armedAgeMs = minimumQuitConfirmationAgeMs,
): QuitConfirmationAction => {
  if (key.ctrl && key.name === "c") return "execute";
  return quitArmed && armedAgeMs >= minimumQuitConfirmationAgeMs ? "execute" : "arm";
};

export interface ScrollContext {
  readonly visibleRows: readonly {
    readonly log: LogEntry;
    readonly lineIndex: number;
  }[];
  readonly startIndex: number;
  readonly maxStartIndex: number;
  readonly paneHeight: number;
}

export interface KeyboardContext {
  readonly scroll: ScrollContext;
  readonly canFocusProcesses: boolean;
  readonly selectedLog: LogEntry | null;
  readonly themePickerListHeight: number;
}

const noCommand: UiCommand = { _tag: "none" };

const isEscapeSequence = (sequence: string | undefined) =>
  sequence === "\x1b" ||
  sequence === "\x1b\x1b" ||
  // A standalone ESC can be coalesced with terminal OSC/CSI/DCS replies before
  // OpenTUI's timeout flushes it, especially in Ghostty inside tmux.
  sequence?.startsWith("\x1b\x1b]") === true ||
  sequence?.startsWith("\x1b\x1bP") === true ||
  sequence?.startsWith("\x1b\x1b_") === true ||
  /^\x1b\x1b\[(?:\?|\>)/.test(sequence ?? "") ||
  /^\x1b\[27(?:;[0-9:]+)*u$/.test(sequence ?? "") ||
  /^\x1b\[27;\d+;27~$/.test(sequence ?? "");

const isEscape = (key: KeyboardKey) =>
  key.name === "escape" ||
  key.name === "esc" ||
  isEscapeSequence(key.raw) ||
  isEscapeSequence(key.sequence);
const isEnter = (key: KeyboardKey) => key.name === "return" || key.name === "enter";
const isBackspace = (key: KeyboardKey) => key.name === "backspace" || key.name === "delete";
const isNextView = (key: KeyboardKey) => key.name === "tab" || (key.ctrl && key.name === "n");
const isPreviousView = (key: KeyboardKey) => key.ctrl && key.name === "p";
const isNextRow = (key: KeyboardKey) => key.name === "down" || key.name === "j";
const isPreviousRow = (key: KeyboardKey) => key.name === "up" || key.name === "k";
const isHelpToggle = (key: KeyboardKey) =>
  key.name === "?" || (key.name === "/" && key.shift === true);
const isThemePickerToggle = (key: KeyboardKey) =>
  key.name === "t" && !key.ctrl && !key.meta && !key.shift;
const isVisualLineKey = (key: KeyboardKey) =>
  !key.ctrl && !key.meta && (key.name === "V" || (key.name === "v" && key.shift === true));
const isLogLevelKey = (key: KeyboardKey) =>
  !key.ctrl && !key.meta && (key.name === "L" || (key.name === "l" && key.shift === true));
const isRestartAllKey = (key: KeyboardKey) =>
  !key.ctrl && !key.meta && (key.name === "R" || (key.name === "r" && key.shift === true));
const isClearLogsKey = (key: KeyboardKey) =>
  !key.ctrl && !key.meta && (key.name === "C" || (key.name === "c" && key.shift === true));
const isEndKey = (key: KeyboardKey) =>
  key.name === "end" ||
  (!key.ctrl && !key.meta && (key.name === "G" || (key.name === "g" && key.shift === true)));
const logLevels: readonly LogLevelFilter[] = ["all", "error", "warn", "info", "system"];
const arrowCodes = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  a: "up",
  b: "down",
  c: "right",
  d: "left",
} as const;
const kittyArrowCodes = {
  57350: "left",
  57351: "right",
  57352: "up",
  57353: "down",
} as const;
const ctrlPaneCodepoints = {
  104: "h",
  106: "j",
  107: "k",
  108: "l",
} as const;

type ArrowDirection = "up" | "down" | "right" | "left";
type PaneKey = "h" | "j" | "k" | "l";

const hasCtrlModifier = (modifier: number) => ((modifier - 1) & 4) !== 0;

const normalizeSequence = (sequence: string) => sequence.replaceAll("\u009b", "\x1b[");
const bareCursorPositionReplyPattern = /^\d{1,3};\d{1,3}R?$/;

const keyboardKey = (input: Partial<KeyboardKey>): KeyboardKey => ({
  name: "",
  ctrl: false,
  meta: false,
  shift: false,
  ...input,
});

const directionFromPlainArrowSequence = (sequence: string): ArrowDirection | null => {
  const normalized = normalizeSequence(sequence);
  const xterm = /^\x1b\[([ABCD])$/.exec(normalized);
  if (xterm) return arrowCodes[xterm[1] as keyof typeof arrowCodes];

  const ss3 = /^\x1bO([ABCD])$/.exec(normalized);
  if (ss3) return arrowCodes[ss3[1] as keyof typeof arrowCodes];

  return null;
};

const directionFromCtrlArrowSequence = (sequence: string): ArrowDirection | null => {
  const normalized = normalizeSequence(sequence);
  const xterm = /^\x1b\[(?:(?:\d+);)?(\d+)(?::\d+)?([ABCD])$/.exec(normalized);
  if (xterm) {
    const modifier = Number(xterm[1]);
    const direction = arrowCodes[xterm[2] as keyof typeof arrowCodes];
    return Number.isFinite(modifier) && hasCtrlModifier(modifier) ? direction : null;
  }

  const ss3 = /^\x1bO([abcd])$/.exec(normalized);
  if (ss3) return arrowCodes[ss3[1] as keyof typeof arrowCodes];

  const compactSs3 = /^\x1bO(\d+)([ABCDabcd])$/.exec(normalized);
  if (compactSs3) {
    const modifier = Number(compactSs3[1]);
    const direction = arrowCodes[compactSs3[2] as keyof typeof arrowCodes];
    return Number.isFinite(modifier) && hasCtrlModifier(modifier) ? direction : null;
  }

  const kitty = /^\x1b\[(5735[0-3]);(\d+)(?:;.*)?u$/.exec(normalized);
  if (kitty) {
    const code = Number(kitty[1]) as keyof typeof kittyArrowCodes;
    const modifier = Number(kitty[2]);
    const direction = kittyArrowCodes[code];
    return Number.isFinite(modifier) && hasCtrlModifier(modifier) ? direction : null;
  }

  const modifyOtherKeys = /^\x1b\[27;(\d+);(5735[0-3])~$/.exec(normalized);
  if (modifyOtherKeys) {
    const modifier = Number(modifyOtherKeys[1]);
    const code = Number(modifyOtherKeys[2]) as keyof typeof kittyArrowCodes;
    const direction = kittyArrowCodes[code];
    return Number.isFinite(modifier) && hasCtrlModifier(modifier) ? direction : null;
  }

  return null;
};

const paneKeyFromCtrlSequence = (sequence: string): PaneKey | null => {
  const normalized = normalizeSequence(sequence);
  const kitty = /^\x1b\[(10[4678]);(\d+)(?::\d+)?(?:;.*)?u$/.exec(normalized);
  if (kitty) {
    const codepoint = Number(kitty[1]) as keyof typeof ctrlPaneCodepoints;
    const modifier = Number(kitty[2]);
    const paneKey = ctrlPaneCodepoints[codepoint];
    return paneKey && Number.isFinite(modifier) && hasCtrlModifier(modifier) ? paneKey : null;
  }

  const modifyOtherKeys = /^\x1b\[27;(\d+);(10[4678])~$/.exec(normalized);
  if (modifyOtherKeys) {
    const modifier = Number(modifyOtherKeys[1]);
    const codepoint = Number(modifyOtherKeys[2]) as keyof typeof ctrlPaneCodepoints;
    const paneKey = ctrlPaneCodepoints[codepoint];
    return paneKey && Number.isFinite(modifier) && hasCtrlModifier(modifier) ? paneKey : null;
  }

  return null;
};

export const keyboardKeyFromInputSequence = (sequence: string): KeyboardKey | null => {
  const paneKey = paneKeyFromCtrlSequence(sequence);
  if (paneKey) return keyboardKey({ name: paneKey, raw: sequence, sequence, ctrl: true });

  // A lone ESC arrives as its own coalesced sequence (the stdin parser flushes
  // it on a short timeout), but the renderer doesn't always forward it to the
  // React keyboard hook. Catch it here so esc reliably closes overlays/modes.
  if (isEscapeSequence(sequence)) {
    return keyboardKey({ name: "escape", raw: sequence, sequence });
  }

  if (sequence === "\b" || sequence === "\x7f") {
    return keyboardKey({ name: "backspace", raw: sequence, sequence });
  }
  if (sequence === "\r") return keyboardKey({ name: "enter", raw: sequence, sequence });
  if (sequence === "\t") return keyboardKey({ name: "tab", raw: sequence, sequence });
  if (sequence === "\x03") return keyboardKey({ name: "c", raw: sequence, sequence, ctrl: true });
  if (sequence === "\x0e") return keyboardKey({ name: "n", raw: sequence, sequence, ctrl: true });
  if (sequence === "\x10") return keyboardKey({ name: "p", raw: sequence, sequence, ctrl: true });
  if (sequence === "\n") return keyboardKey({ name: "j", raw: sequence, sequence, ctrl: true });
  if (sequence === "\v") return keyboardKey({ name: "k", raw: sequence, sequence, ctrl: true });
  if (sequence === "\f") return keyboardKey({ name: "l", raw: sequence, sequence, ctrl: true });

  const ctrlArrow = directionFromCtrlArrowSequence(sequence);
  if (ctrlArrow) return keyboardKey({ name: ctrlArrow, raw: sequence, sequence, ctrl: true });

  const plainArrow = directionFromPlainArrowSequence(sequence);
  if (plainArrow) return keyboardKey({ name: plainArrow, raw: sequence, sequence });

  if (sequence.length === 1) {
    const codepoint = sequence.codePointAt(0) ?? 0;
    if (codepoint >= 0x20 && codepoint !== 0x7f) {
      return keyboardKey({
        name: sequence,
        raw: sequence,
        sequence,
        shift:
          sequence.toLocaleUpperCase() === sequence && sequence.toLocaleLowerCase() !== sequence,
      });
    }
  }

  return null;
};

export const keyboardKeysFromInputSequence = (sequence: string): readonly KeyboardKey[] => {
  const key = keyboardKeyFromInputSequence(sequence);
  if (key) return [key];
  if (sequence.includes("\x1b")) return [];
  if (bareCursorPositionReplyPattern.test(sequence)) return [];
  return Array.from(sequence).flatMap((character) => {
    const parsed = keyboardKeyFromInputSequence(character);
    return parsed ? [parsed] : [];
  });
};

const ctrlArrowDirection = (key: KeyboardKey): ArrowDirection | null => {
  if (key.ctrl) {
    if (key.name === "up" || key.name === "down" || key.name === "right" || key.name === "left")
      return key.name;
    if (key.code === "[A" || key.code === "OA") return "up";
    if (key.code === "[B" || key.code === "OB") return "down";
    if (key.code === "[C" || key.code === "OC") return "right";
    if (key.code === "[D" || key.code === "OD") return "left";
  }

  for (const sequence of [key.raw, key.sequence]) {
    if (!sequence) continue;
    const direction = directionFromCtrlArrowSequence(sequence);
    if (direction) return direction;
  }

  return null;
};

const plainHorizontalArrowDirection = (key: KeyboardKey): "right" | "left" | null => {
  if (key.ctrl || key.meta || key.shift) return null;
  if (key.name === "right" || key.code === "[C" || key.code === "OC") return "right";
  if (key.name === "left" || key.code === "[D" || key.code === "OD") return "left";
  for (const sequence of [key.raw, key.sequence]) {
    if (!sequence) continue;
    const direction = directionFromPlainArrowSequence(sequence);
    if (direction === "right" || direction === "left") return direction;
  }
  return null;
};

const ctrlPaneKey = (key: KeyboardKey): PaneKey | null => {
  if (key.ctrl && (key.name === "h" || key.name === "j" || key.name === "k" || key.name === "l"))
    return key.name;

  for (const sequence of [key.raw, key.sequence]) {
    if (!sequence) continue;
    const paneKey = paneKeyFromCtrlSequence(sequence);
    if (paneKey) return paneKey;
  }

  if (
    !key.ctrl &&
    !key.meta &&
    (key.name === "backspace" || key.raw === "\b" || key.raw === "\x7f")
  )
    return "h";

  return null;
};

const nextLogLevel = (level: LogLevelFilter): LogLevelFilter =>
  logLevels[(logLevels.indexOf(level) + 1) % logLevels.length] ?? "all";

const switchView = (processes: readonly ProcessRuntime[], viewId: ViewId, delta: number) => {
  const ids = ["merged", ...processes.map((process) => process.id)];
  const current = ids.indexOf(viewId);
  return ids[(current + ids.length + delta) % ids.length] ?? "merged";
};

const resetLogScroll = (state: UiState): UiState => ({
  ...state,
  logAnchorId: null,
  logAnchorLineIndex: 0,
  selectedLogId: null,
  selectedLogLineIndex: 0,
});

const formatCopiedLog = (log: LogEntry) =>
  `${new Date(log.timestampMs).toISOString()} ${log.processName} ${log.stream} ${log.severity} ${log.text}`;

const clearSelection = (state: UiState): UiState => ({
  ...state,
  markedLogIds: [],
  visualAnchorId: null,
  visualAnchorLineIndex: 0,
});

const closeThemePicker = (state: UiState): UiState => ({
  ...state,
  themePickerOpen: false,
  themeFilterText: "",
  themeScrollIndex: 0,
});

const openThemePicker = (state: UiState): UiState => ({
  ...state,
  filterMode: false,
  searchMode: false,
  helpOpen: false,
  processPickerOpen: false,
  themePickerOpen: true,
  themeFilterText: "",
  themeScrollIndex: 0,
});

const selectThemeFromRows = (state: UiState, rows: readonly UiState["themeName"][]) =>
  rows.includes(state.themeName) ? state.themeName : (rows[0] ?? state.themeName);

const scrollIndexForTheme = (
  rows: readonly UiState["themeName"][],
  themeName: UiState["themeName"],
  listHeight: number,
  currentScrollIndex: number,
) => {
  const maxScrollIndex = Math.max(0, rows.length - listHeight);
  const selectedIndex = rows.indexOf(themeName);
  if (selectedIndex < 0) return Math.min(currentScrollIndex, maxScrollIndex);
  if (selectedIndex < currentScrollIndex) return selectedIndex;
  if (selectedIndex >= currentScrollIndex + listHeight) {
    return Math.min(maxScrollIndex, selectedIndex - listHeight + 1);
  }
  return Math.min(currentScrollIndex, maxScrollIndex);
};

const reduceThemeSearch = (state: UiState, query: string, listHeight: number): UiState => {
  const rows = themeNamesMatching(query);
  const themeName = selectThemeFromRows(state, rows);
  return {
    ...state,
    themeFilterText: query,
    themeName,
    themeScrollIndex: scrollIndexForTheme(rows, themeName, listHeight, 0),
  };
};

const reduceThemeSelection = (state: UiState, delta: number, listHeight: number): UiState => {
  const rows = themeNamesMatching(state.themeFilterText);
  if (rows.length === 0) return state;
  const currentIndex = rows.indexOf(state.themeName);
  const index = currentIndex >= 0 ? currentIndex : 0;
  const themeName = rows[(index + rows.length + delta) % rows.length] ?? state.themeName;
  return {
    ...state,
    themeName,
    themeScrollIndex: scrollIndexForTheme(rows, themeName, listHeight, state.themeScrollIndex),
  };
};

const hasSelection = (state: UiState) =>
  state.markedLogIds.length > 0 || state.visualAnchorId !== null;

const toggleMark = (markedLogIds: readonly number[], id: number): readonly number[] =>
  markedLogIds.includes(id)
    ? markedLogIds.filter((marked) => marked !== id)
    : [...markedLogIds, id];

const cursorIndex = (scroll: ScrollContext, state: UiState): number =>
  state.selectedLogId === null
    ? scroll.visibleRows.length - 1
    : scroll.visibleRows.findIndex(
        (row) => row.log.id === state.selectedLogId && row.lineIndex === state.selectedLogLineIndex,
      );

// Rows from the same wrapped entry are contiguous, so the next entry starts just
// past the last row that shares the cursor's id. Returns how many rows down that
// is (0 when the cursor is already on the final entry).
const rowsToNextEntry = (scroll: ScrollContext, fromIndex: number): number => {
  const rows = scroll.visibleRows;
  if (fromIndex < 0 || fromIndex >= rows.length) return 0;
  const currentId = rows[fromIndex]?.log.id;
  let index = fromIndex + 1;
  while (index < rows.length && rows[index]?.log.id === currentId) index += 1;
  return index >= rows.length ? 0 : index - fromIndex;
};

const copyCommand = (state: UiState, context: KeyboardContext): KeyboardResult => {
  const scroll = context.scroll;
  const selectedIds = resolveSelectedLogIds(
    scroll.visibleRows,
    state.markedLogIds,
    state.visualAnchorId === null
      ? null
      : { id: state.visualAnchorId, lineIndex: state.visualAnchorLineIndex },
    { id: state.selectedLogId, lineIndex: state.selectedLogLineIndex },
  );

  if (selectedIds.size > 0) {
    const seen = new Set<number>();
    const logs: LogEntry[] = [];
    for (const row of scroll.visibleRows) {
      if (selectedIds.has(row.log.id) && !seen.has(row.log.id)) {
        seen.add(row.log.id);
        logs.push(row.log);
      }
    }
    return logs.length > 0
      ? {
          state: clearSelection(state),
          command: {
            _tag: "copyText",
            text: logs.map(formatCopiedLog).join("\n"),
            logIds: logs.map((log) => log.id),
          },
        }
      : { state, command: noCommand };
  }

  return context.selectedLog
    ? {
        state,
        command: {
          _tag: "copyText",
          text: formatCopiedLog(context.selectedLog),
          logIds: [context.selectedLog.id],
        },
      }
    : { state, command: noCommand };
};

const selectedProcess = (state: UiState, processes: readonly ProcessRuntime[]) =>
  state.viewId === "merged"
    ? null
    : (processes.find((process) => process.id === state.viewId) ?? null);

const copyProcessUrlCommand = (
  state: UiState,
  processes: readonly ProcessRuntime[],
): KeyboardResult => {
  const process = selectedProcess(state, processes);
  if (!process) {
    return {
      state,
      command: { _tag: "notify", message: "select a process to copy its URL" },
    };
  }

  const endpoint = bestProcessEndpoint(process);
  return endpoint
    ? {
        state,
        command: {
          _tag: "copyText",
          text: endpoint.url,
          logIds: [],
          label: `copied ${endpoint.source} URL`,
        },
      }
    : {
        state,
        command: { _tag: "notify", message: `${process.spec.name} has no URL` },
      };
};

const reduceQueryInput = (
  key: KeyboardKey,
  state: UiState,
  mode: "filter" | "search",
  context: KeyboardContext,
): KeyboardResult | null => {
  const modeKey = mode === "filter" ? "filterMode" : "searchMode";
  const textKey = mode === "filter" ? "filterText" : "searchText";

  if (isEscape(key)) {
    return {
      state: resetLogScroll({ ...state, [modeKey]: false, [textKey]: "" }),
      command: noCommand,
    };
  }
  if (key.ctrl && key.name === "c") {
    return {
      state:
        state[textKey].length > 0
          ? resetLogScroll({ ...state, [textKey]: "" })
          : { ...state, [modeKey]: false },
      command: noCommand,
    };
  }
  if (isEnter(key)) {
    const committed = { ...state, [modeKey]: false };
    // Committing a search lands on the first hit so the current-match cursor and
    // its `match 1 of N` counter are immediately live; n / N take it from there.
    if (mode === "search") {
      const first = searchMatchRowIndices(context.scroll, state.searchText)[0];
      return {
        state: first === undefined ? committed : focusRowCentered(committed, context.scroll, first),
        command: noCommand,
      };
    }
    return { state: committed, command: noCommand };
  }
  if (isBackspace(key)) {
    return {
      state: resetLogScroll({ ...state, [textKey]: state[textKey].slice(0, -1) }),
      command: noCommand,
    };
  }
  const printable = extractPrintable(key);
  return printable
    ? {
        state: resetLogScroll({ ...state, [textKey]: state[textKey] + printable }),
        command: noCommand,
      }
    : { state, command: noCommand };
};

const focusPane = (
  state: UiState,
  canFocusProcesses: boolean,
  pane: UiState["focusedPane"],
): UiState => ({
  ...state,
  focusedPane: canFocusProcesses ? pane : "logs",
  processPickerOpen: false,
});

const reducePaneFocus = (
  key: KeyboardKey,
  state: UiState,
  context: KeyboardContext,
): UiState | null => {
  const arrowDirection = ctrlArrowDirection(key);
  const paneKey = ctrlPaneKey(key);
  const horizontalArrowDirection = plainHorizontalArrowDirection(key);
  const isPlainHorizontalPaneKey =
    !key.ctrl && !key.meta && !key.shift && (key.name === "h" || key.name === "l");

  if (
    arrowDirection === "right" ||
    horizontalArrowDirection === "right" ||
    paneKey === "l" ||
    (isPlainHorizontalPaneKey && key.name === "l")
  ) {
    return focusPane(state, context.canFocusProcesses, "logs");
  }
  if (
    arrowDirection === "left" ||
    horizontalArrowDirection === "left" ||
    paneKey === "h" ||
    (isPlainHorizontalPaneKey && key.name === "h")
  ) {
    return focusPane(state, context.canFocusProcesses, "processes");
  }
  if (arrowDirection === "down" || paneKey === "j")
    return focusPane(state, context.canFocusProcesses, "logs");
  if (arrowDirection === "up" || paneKey === "k")
    return focusPane(state, context.canFocusProcesses, "processes");

  return null;
};

export const reduceLogScroll = (
  state: UiState,
  scroll: ScrollContext,
  deltaRows: number,
): UiState => {
  if (scroll.maxStartIndex <= 0 || deltaRows === 0) return resetLogScroll(state);

  const startIndex =
    state.logAnchorId === null && deltaRows < 0 ? scroll.maxStartIndex : scroll.startIndex;
  const nextStartIndex = Math.max(0, Math.min(scroll.maxStartIndex, startIndex + deltaRows));

  if (nextStartIndex >= scroll.maxStartIndex && deltaRows > 0) return resetLogScroll(state);

  const nextRow = scroll.visibleRows[nextStartIndex];

  return {
    ...state,
    focusedPane: "logs",
    logAnchorId: nextRow?.log.id ?? null,
    logAnchorLineIndex: nextRow?.lineIndex ?? 0,
    selectedLogId: nextRow?.log.id ?? null,
    selectedLogLineIndex: nextRow?.lineIndex ?? 0,
  };
};

const reduceLogCursor = (state: UiState, scroll: ScrollContext, deltaRows: number): UiState => {
  if (scroll.visibleRows.length === 0 || deltaRows === 0) {
    return { ...state, selectedLogId: null, selectedLogLineIndex: 0 };
  }

  const selectedIndex =
    state.selectedLogId === null
      ? scroll.visibleRows.length - 1
      : scroll.visibleRows.findIndex(
          (row) =>
            row.log.id === state.selectedLogId && row.lineIndex === state.selectedLogLineIndex,
        );
  const currentIndex = selectedIndex >= 0 ? selectedIndex : scroll.visibleRows.length - 1;
  const nextIndex = Math.max(0, Math.min(scroll.visibleRows.length - 1, currentIndex + deltaRows));
  const nextRow = scroll.visibleRows[nextIndex];
  if (!nextRow) return { ...state, selectedLogId: null, selectedLogLineIndex: 0 };

  if (nextIndex === scroll.visibleRows.length - 1) {
    return resetLogScroll({ ...state, focusedPane: "logs" });
  }

  const viewportEnd = scroll.startIndex + scroll.paneHeight;
  const nextStartIndex =
    nextIndex < scroll.startIndex
      ? nextIndex
      : nextIndex >= viewportEnd
        ? Math.max(0, nextIndex - scroll.paneHeight + 1)
        : scroll.startIndex;

  const anchorRow = scroll.visibleRows[Math.min(nextStartIndex, scroll.maxStartIndex)];

  return {
    ...state,
    focusedPane: "logs",
    logAnchorId: anchorRow?.log.id ?? null,
    logAnchorLineIndex: anchorRow?.lineIndex ?? 0,
    selectedLogId: nextRow.log.id,
    selectedLogLineIndex: nextRow.lineIndex,
  };
};

// Indices (into the scroll's visible rows) of the first row of every entry that
// matches the search query — the hits `n` / `N` move between. Wrapped lines past
// the first are skipped so each matching entry counts once, matching the
// `match X of Y` total the view model derives from the entries themselves.
const searchMatchRowIndices = (scroll: ScrollContext, query: string): readonly number[] => {
  if (query.trim().length === 0) return [];
  const indices: number[] = [];
  scroll.visibleRows.forEach((row, index) => {
    if (row.lineIndex === 0 && logMatchesQuery(row.log, query)) indices.push(index);
  });
  return indices;
};

// Move the cursor onto the row at `targetIndex`, centering it in the viewport so
// a jump to a far-off hit lands in view. Mirrors reduceLogCursor's tail handling
// so landing on the newest row resumes following.
const focusRowCentered = (state: UiState, scroll: ScrollContext, targetIndex: number): UiState => {
  const nextRow = scroll.visibleRows[targetIndex];
  if (!nextRow) return state;
  if (targetIndex >= scroll.visibleRows.length - 1) {
    return resetLogScroll({ ...state, focusedPane: "logs" });
  }
  const desiredStart = Math.max(
    0,
    Math.min(scroll.maxStartIndex, targetIndex - Math.floor(scroll.paneHeight / 2)),
  );
  const anchorRow = scroll.visibleRows[desiredStart];
  return {
    ...state,
    focusedPane: "logs",
    logAnchorId: anchorRow?.log.id ?? null,
    logAnchorLineIndex: anchorRow?.lineIndex ?? 0,
    selectedLogId: nextRow.log.id,
    selectedLogLineIndex: nextRow.lineIndex,
  };
};

// Jump the cursor to the next (`direction > 0`) or previous search hit relative
// to where it sits now, wrapping around the ends like vim's n / N.
const jumpToSearchMatch = (state: UiState, scroll: ScrollContext, direction: 1 | -1): UiState => {
  const matches = searchMatchRowIndices(scroll, state.searchText);
  if (matches.length === 0) return state;
  const rawCursor = cursorIndex(scroll, state);
  const cursor = rawCursor < 0 ? scroll.visibleRows.length - 1 : rawCursor;
  const target =
    direction > 0
      ? (matches.find((index) => index > cursor) ?? matches[0])
      : ([...matches].reverse().find((index) => index < cursor) ?? matches[matches.length - 1]);
  return focusRowCentered(state, scroll, target ?? matches[0] ?? 0);
};

export const reduceKeyboard = (
  key: KeyboardKey,
  state: UiState,
  processes: readonly ProcessRuntime[],
  context: KeyboardContext,
): KeyboardResult => {
  const scroll = context.scroll;

  if (state.filterMode) {
    return reduceQueryInput(key, state, "filter", context) ?? { state, command: noCommand };
  }

  if (state.searchMode) {
    return reduceQueryInput(key, state, "search", context) ?? { state, command: noCommand };
  }

  if (state.helpOpen) {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      return { state: { ...state, helpOpen: false }, command: { _tag: "quit" } };
    }
    if (isEscape(key) || isHelpToggle(key)) {
      return { state: { ...state, helpOpen: false }, command: noCommand };
    }
    return { state, command: noCommand };
  }

  if (state.themePickerOpen) {
    const listHeight = Math.max(1, context.themePickerListHeight);
    if (key.ctrl && key.name === "c") {
      return { state, command: { _tag: "quit" } };
    }
    if (isEscape(key)) {
      return { state: closeThemePicker(state), command: noCommand };
    }
    if (isEnter(key)) {
      return { state: closeThemePicker(state), command: noCommand };
    }
    const themeNext =
      key.name === "down" || (state.themeFilterText.length === 0 && key.name === "j");
    const themePrevious =
      key.name === "up" || (state.themeFilterText.length === 0 && key.name === "k");
    if (themeNext) {
      return { state: reduceThemeSelection(state, 1, listHeight), command: noCommand };
    }
    if (themePrevious) {
      return { state: reduceThemeSelection(state, -1, listHeight), command: noCommand };
    }
    if (isBackspace(key)) {
      return {
        state: reduceThemeSearch(state, state.themeFilterText.slice(0, -1), listHeight),
        command: noCommand,
      };
    }
    const printable = extractPrintable(key);
    return printable
      ? {
          state: reduceThemeSearch(state, state.themeFilterText + printable, listHeight),
          command: noCommand,
        }
      : { state, command: noCommand };
  }

  if (state.processPickerOpen) {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      return { state, command: { _tag: "quit" } };
    }
    if (isEscape(key) || isEnter(key) || key.name === "p") {
      return { state: { ...state, processPickerOpen: false }, command: noCommand };
    }
    if (isNextView(key) || isNextRow(key)) {
      return {
        state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, 1) }),
        command: noCommand,
      };
    }
    if (isPreviousView(key) || isPreviousRow(key)) {
      return {
        state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, -1) }),
        command: noCommand,
      };
    }
    const numeric = Number(key.name);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) {
      const process = processes[numeric - 1];
      return process
        ? {
            state: resetLogScroll({ ...state, viewId: process.id, processPickerOpen: false }),
            command: noCommand,
          }
        : { state, command: noCommand };
    }
    if (key.name === "m") {
      return {
        state: resetLogScroll({ ...state, viewId: "merged", processPickerOpen: false }),
        command: noCommand,
      };
    }
    return { state, command: noCommand };
  }

  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { state, command: { _tag: "quit" } };
  }

  if (key.name === "p") {
    return { state: { ...state, processPickerOpen: true }, command: noCommand };
  }

  if (isHelpToggle(key)) {
    return { state: { ...state, helpOpen: true }, command: noCommand };
  }

  if (isThemePickerToggle(key)) {
    return { state: openThemePicker(state), command: noCommand };
  }

  const paneFocus = reducePaneFocus(key, state, context);
  if (paneFocus) return { state: paneFocus, command: noCommand };

  if (key.name === "/" && !key.shift) {
    return { state: { ...state, filterMode: false, searchMode: true }, command: noCommand };
  }

  if (isEscape(key)) {
    if (hasSelection(state)) {
      return { state: clearSelection(state), command: noCommand };
    }
    // Peel one layer at a time: an active search first (keeping the filter it
    // runs inside), then the filter / level, then the per-process view.
    if (state.searchText) {
      return { state: resetLogScroll({ ...state, searchText: "" }), command: noCommand };
    }
    if (state.filterText || state.logLevel !== "all") {
      return {
        state: resetLogScroll({ ...state, filterText: "", logLevel: "all" }),
        command: noCommand,
      };
    }
    return { state: resetLogScroll({ ...state, viewId: "merged" }), command: noCommand };
  }

  // n / N step between search hits (handles real uppercase `N`, which arrives as
  // its own key name rather than n+shift). Only while a search is committed.
  if (state.searchText && !key.ctrl && !key.meta) {
    if (key.name === "n" && !key.shift) {
      return { state: jumpToSearchMatch(state, scroll, 1), command: noCommand };
    }
    if (key.name === "N" || (key.name === "n" && key.shift)) {
      return { state: jumpToSearchMatch(state, scroll, -1), command: noCommand };
    }
  }

  // `f` inside a search "filters to the hits": promote the query to a filter and
  // drop the search entirely (clearing its text) so it becomes a plain filter.
  if (state.searchText && key.name === "f" && !key.ctrl && !key.meta && !key.shift) {
    return {
      state: resetLogScroll({
        ...state,
        filterText: state.searchText,
        searchText: "",
        searchMode: false,
      }),
      command: noCommand,
    };
  }

  if (key.name === "f" && !key.ctrl && !key.meta && !key.shift) {
    return { state: { ...state, filterMode: true, searchMode: false }, command: noCommand };
  }

  if (isLogLevelKey(key)) {
    return {
      state: resetLogScroll({ ...state, logLevel: nextLogLevel(state.logLevel) }),
      command: noCommand,
    };
  }

  if (state.focusedPane === "logs" || !context.canFocusProcesses) {
    if (isNextRow(key)) {
      return {
        state: reduceLogCursor(focusPane(state, context.canFocusProcesses, "logs"), scroll, 1),
        command: noCommand,
      };
    }

    if (isPreviousRow(key)) {
      return {
        state: reduceLogCursor(focusPane(state, context.canFocusProcesses, "logs"), scroll, -1),
        command: noCommand,
      };
    }

    if ((key.name === "c" && !key.shift) || (key.name === "y" && !key.shift)) {
      return copyCommand(state, context);
    }

    if (key.name === "x" && !key.shift) {
      const index = cursorIndex(scroll, state);
      const id = scroll.visibleRows[index]?.log.id;
      if (id === undefined) return { state, command: noCommand };
      const marked = { ...state, markedLogIds: toggleMark(state.markedLogIds, id) };
      const delta = rowsToNextEntry(scroll, index);
      return {
        state: delta > 0 ? reduceLogCursor(marked, scroll, delta) : marked,
        command: noCommand,
      };
    }

    if (isVisualLineKey(key)) {
      if (state.visualAnchorId !== null) {
        return {
          state: { ...state, visualAnchorId: null, visualAnchorLineIndex: 0 },
          command: noCommand,
        };
      }
      const index = cursorIndex(scroll, state);
      const row = scroll.visibleRows[index];
      if (!row) return { state, command: noCommand };
      return {
        state: {
          ...state,
          focusedPane: "logs",
          visualAnchorId: row.log.id,
          visualAnchorLineIndex: row.lineIndex,
          selectedLogId: row.log.id,
          selectedLogLineIndex: row.lineIndex,
        },
        command: noCommand,
      };
    }
  }

  if (
    state.focusedPane === "processes" &&
    context.canFocusProcesses &&
    key.name === "c" &&
    !key.shift
  ) {
    return copyProcessUrlCommand(state, processes);
  }

  if (state.focusedPane === "processes" && context.canFocusProcesses && isNextRow(key)) {
    return {
      state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, 1) }),
      command: noCommand,
    };
  }

  if (state.focusedPane === "processes" && context.canFocusProcesses && isPreviousRow(key)) {
    return {
      state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, -1) }),
      command: noCommand,
    };
  }

  if (isNextView(key)) {
    return {
      state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, 1) }),
      command: noCommand,
    };
  }

  if (isPreviousView(key)) {
    return {
      state: resetLogScroll({ ...state, viewId: switchView(processes, state.viewId, -1) }),
      command: noCommand,
    };
  }

  if (key.name === "m") {
    return { state: resetLogScroll({ ...state, viewId: "merged" }), command: noCommand };
  }

  const numeric = Number(key.name);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) {
    const process = processes[numeric - 1];
    return process
      ? { state: resetLogScroll({ ...state, viewId: process.id }), command: noCommand }
      : { state, command: noCommand };
  }

  if (isRestartAllKey(key)) {
    return { state: resetLogScroll(state), command: { _tag: "restartAll" } };
  }

  if (key.name === "r" && !key.shift && state.viewId !== "merged") {
    return { state: resetLogScroll(state), command: { _tag: "restartProcess", id: state.viewId } };
  }

  if (
    key.name === "x" &&
    state.focusedPane === "processes" &&
    context.canFocusProcesses &&
    state.viewId !== "merged"
  ) {
    return { state, command: { _tag: "stopProcess", id: state.viewId } };
  }

  if (isClearLogsKey(key)) {
    return { state: resetLogScroll(state), command: { _tag: "clearLogs" } };
  }

  if (key.name === "pageup") {
    return {
      state: reduceLogScroll(state, scroll, -Math.max(1, scroll.paneHeight - 1)),
      command: noCommand,
    };
  }

  if (key.name === "pagedown") {
    return {
      state: reduceLogScroll(state, scroll, Math.max(1, scroll.paneHeight - 1)),
      command: noCommand,
    };
  }

  if (key.ctrl && key.name === "u") {
    return {
      state: reduceLogScroll(state, scroll, -Math.max(1, Math.floor(scroll.paneHeight / 2))),
      command: noCommand,
    };
  }

  if (key.ctrl && key.name === "d") {
    return {
      state: reduceLogScroll(state, scroll, Math.max(1, Math.floor(scroll.paneHeight / 2))),
      command: noCommand,
    };
  }

  if (isEndKey(key)) {
    return { state: resetLogScroll(state), command: noCommand };
  }

  if (key.name === "home") {
    const firstRow = scroll.visibleRows[0];
    return {
      state: {
        ...state,
        focusedPane: "logs",
        logAnchorId: scroll.maxStartIndex > 0 ? (firstRow?.log.id ?? null) : null,
        logAnchorLineIndex: scroll.maxStartIndex > 0 ? (firstRow?.lineIndex ?? 0) : 0,
        selectedLogId: firstRow?.log.id ?? null,
        selectedLogLineIndex: firstRow?.lineIndex ?? 0,
      },
      command: noCommand,
    };
  }

  return { state, command: noCommand };
};
