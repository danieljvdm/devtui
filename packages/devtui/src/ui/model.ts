import type { LogEntry, ProcessRuntime, RunnerSnapshot } from "../core/domain.ts";
import type { FocusedPane, LogLevelFilter } from "./state.ts";

// A query bar (filter or search) is this many rows tall. The design's 4px padding
// is sub-character, so the band is a single row at terminal resolution. Shared
// with the QueryLine component.
export const QUERY_BAR_HEIGHT = 1;

export interface LogDisplayRow {
  readonly log: LogEntry;
  readonly lineIndex: number;
  readonly totalLines: number;
  readonly text: string;
}

export interface ViewModelInput {
  readonly snapshot: RunnerSnapshot;
  readonly viewId: string;
  readonly filterText: string;
  readonly searchText: string;
  readonly logLevel: LogLevelFilter;
  readonly filterMode: boolean;
  readonly searchMode: boolean;
  readonly showProcessList: boolean;
  readonly sideRail: boolean;
  readonly logAnchorId: number | null;
  readonly logAnchorLineIndex: number;
  readonly selectedLogId: number | null;
  readonly selectedLogLineIndex: number;
  readonly focusedPane: FocusedPane;
  readonly height: number;
  readonly logWidth: number;
  readonly markedLogIds: readonly number[];
  readonly visualAnchorId: number | null;
  readonly visualAnchorLineIndex: number;
}

export interface SelectionCursor {
  readonly id: number | null;
  readonly lineIndex: number;
}

export interface VisualAnchor {
  readonly id: number;
  readonly lineIndex: number;
}

/**
 * The set of log-entry ids that count as "selected" right now: every explicitly
 * marked entry, plus — when visual mode is active — every entry whose row falls
 * between the visual anchor and the cursor (inclusive). Shared by the keyboard
 * reducer (to gather copy text) and the view model (to highlight rows) so both
 * always agree.
 */
export const resolveSelectedLogIds = (
  rows: readonly { readonly log: { readonly id: number }; readonly lineIndex: number }[],
  markedLogIds: readonly number[],
  visualAnchor: VisualAnchor | null,
  cursor: SelectionCursor,
): ReadonlySet<number> => {
  const ids = new Set(markedLogIds);
  if (visualAnchor === null) return ids;

  const anchorIndex = rows.findIndex(
    (row) => row.log.id === visualAnchor.id && row.lineIndex === visualAnchor.lineIndex,
  );
  if (anchorIndex < 0) return ids;

  const cursorIndex =
    cursor.id === null
      ? rows.length - 1
      : rows.findIndex((row) => row.log.id === cursor.id && row.lineIndex === cursor.lineIndex);
  if (cursorIndex < 0) return ids;

  const low = Math.min(anchorIndex, cursorIndex);
  const high = Math.max(anchorIndex, cursorIndex);
  for (let index = low; index <= high; index++) {
    const row = rows[index];
    if (row) ids.add(row.log.id);
  }
  return ids;
};

export interface ViewModel {
  readonly activeLabel: string;
  readonly visibleLogs: readonly LogEntry[];
  readonly scrollRows: readonly LogDisplayRow[];
  readonly logRows: readonly LogDisplayRow[];
  readonly processPaneHeight: number;
  readonly logPaneHeight: number;
  readonly scrollStartIndex: number;
  readonly scrollEndIndex: number;
  readonly maxScrollStartIndex: number;
  readonly isFollowing: boolean;
  readonly focusedPane: FocusedPane;
  readonly canFocusProcesses: boolean;
  readonly selectedLog: LogEntry | null;
  readonly selectedLogIds: ReadonlySet<number>;
  readonly selectionCount: number;
  readonly visualMode: boolean;
  readonly filteredCount: number;
  readonly hiddenLogCount: number;
  readonly searchMatchCount: number;
  readonly selectedSearchMatchIndex: number | null;
  readonly displayRowCount: number;
  readonly scrollbar: ScrollbarModel | null;
}

export interface ScrollbarModel {
  readonly thumbTop: number;
  readonly thumbHeight: number;
  readonly trackHeight: number;
}

export interface LayoutModel {
  readonly showSideRail: boolean;
  readonly showCompactSideRail: boolean;
  readonly showAnySideRail: boolean;
  readonly showTopProcesses: boolean;
  readonly processRailWidth: number;
  readonly logPaneWidth: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const processRailWidthFor = (
  processes: readonly ProcessRuntime[],
  mode: "full" | "compact",
) => {
  const indexWidth = Math.max(1, String(processes.length).length);
  const longestName = Math.max(
    "merged".length,
    ...processes.map((process) => process.spec.name.length),
  );
  const maxRailWidth = mode === "full" ? 24 : 20;
  const maxNameWidth = Math.max(3, maxRailWidth - indexWidth - 9);
  const nameWidth = clamp(longestName, "merged".length, maxNameWidth);

  // Left/right padding + selector + index + status dot + spaces + process name,
  // plus two spare columns so the rail does not feel cramped.
  return indexWidth + 9 + nameWidth;
};

export const buildLayoutModel = (
  width: number,
  height: number,
  processes: readonly ProcessRuntime[] = [],
): LayoutModel => {
  const showSideRail = width >= 110 && height >= 18;
  const showCompactSideRail = !showSideRail && width >= 76 && height >= 18;
  const showAnySideRail = showSideRail || showCompactSideRail;
  const showTopProcesses = !showAnySideRail && width >= 72 && height >= 22;
  const processRailWidth = showAnySideRail
    ? processRailWidthFor(processes, showSideRail ? "full" : "compact")
    : width;
  const logPaneWidth = showAnySideRail ? Math.max(1, width - processRailWidth - 1) : width;

  return {
    showSideRail,
    showCompactSideRail,
    showAnySideRail,
    showTopProcesses,
    processRailWidth,
    logPaneWidth,
  };
};

export const filterLogs = (
  logs: readonly LogEntry[],
  viewId: string,
  filterText: string,
  logLevel: LogLevelFilter,
) => {
  const lowerFilter = filterText.trim().toLowerCase();
  return logs.filter((log) => {
    if (viewId !== "merged" && log.processId !== viewId) return false;
    if (logLevel !== "all" && log.severity !== logLevel) return false;
    if (!lowerFilter) return true;
    return `${log.processName} ${log.stream} ${log.text}`.toLowerCase().includes(lowerFilter);
  });
};

export const logMatchesQuery = (log: LogEntry, query: string) => {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return false;
  return `${log.processName} ${log.stream} ${log.text}`.toLowerCase().includes(lowerQuery);
};

export const activeLabel = (processes: readonly ProcessRuntime[], viewId: string) =>
  viewId === "merged"
    ? "merged"
    : (processes.find((process) => process.id === viewId)?.spec.name ?? "merged");

const indexForAnchor = (
  rows: readonly LogDisplayRow[],
  anchorId: number,
  anchorLineIndex: number,
  maxStartIndex: number,
) => {
  const exactIndex = rows.findIndex(
    (row) => row.log.id === anchorId && row.lineIndex === anchorLineIndex,
  );
  if (exactIndex >= 0) return Math.min(exactIndex, maxStartIndex);

  const sameLogIndex = rows.findIndex((row) => row.log.id === anchorId);
  if (sameLogIndex >= 0) return Math.min(sameLogIndex, maxStartIndex);

  const nextIndex = rows.findIndex((row) => row.log.id > anchorId);
  if (nextIndex >= 0) return Math.min(nextIndex, maxStartIndex);

  return maxStartIndex;
};

export const LOG_TIME_WIDTH = "00:00:00".length;
export const LOG_DIVIDER = " │ ";

/**
 * Width of the metadata gutter that precedes a log message:
 * `HH:MM:SS <marker> │ ` — timestamp (8) + a one-cell pad + the one-cell error
 * marker + the divider. Fixed regardless of process count, so the message
 * column starts in the same place on every screen. Kept in one place so the
 * renderer and the wrap calculation never drift apart.
 */
export const logMetaWidth = LOG_TIME_WIDTH + 1 + 1 + LOG_DIVIDER.length;

const wrapText = (text: string, width: number) => {
  if (width <= 0) return [""];
  const rows: string[] = [];
  for (let index = 0; index < text.length; index += width) {
    rows.push(text.slice(index, index + width));
  }
  return rows.length === 0 ? [""] : rows;
};

const buildDisplayRows = (
  logs: readonly LogEntry[],
  logPaneWidth: number,
): readonly LogDisplayRow[] => {
  const textWidth = Math.max(1, logPaneWidth - logMetaWidth - 2);
  return logs.flatMap((log) => {
    const textRows = wrapText(log.text, textWidth);
    return textRows.map((text, lineIndex) => ({
      log,
      lineIndex,
      totalLines: textRows.length,
      text,
    }));
  });
};

const buildScrollbar = (
  totalRows: number,
  viewportHeight: number,
  startIndex: number,
  maxStartIndex: number,
): ScrollbarModel | null => {
  if (totalRows <= viewportHeight) return null;

  const trackHeight = Math.max(1, viewportHeight);
  const thumbHeight = Math.max(1, Math.floor((trackHeight * viewportHeight) / totalRows));
  const movableTrack = Math.max(0, trackHeight - thumbHeight);
  const thumbTop =
    maxStartIndex === 0 ? 0 : Math.floor((startIndex * movableTrack) / maxStartIndex);

  return { thumbTop, thumbHeight, trackHeight };
};

export const buildViewModel = (input: ViewModelInput): ViewModel => {
  const processPaneHeight = input.showProcessList
    ? Math.min(input.height - 5, input.snapshot.processes.length + 4)
    : 0;
  // Filter and search render as independent bottom bands (each QUERY_BAR_HEIGHT
  // rows: text centered between padding) and can be on screen at the same time
  // (search within an active filter).
  const filterRowVisible = input.filterMode || input.filterText.length > 0;
  const searchRowVisible = input.searchMode || input.searchText.length > 0;
  const queryActive = filterRowVisible || searchRowVisible;
  const queryHeight =
    (filterRowVisible ? QUERY_BAR_HEIGHT : 0) + (searchRowVisible ? QUERY_BAR_HEIGHT : 0);
  // Status bar (1) + the rule above it, plus a second rule under the top process
  // list when shown. An active query band abuts the status bar directly, so the
  // rule above the status bar is dropped — the band itself is the separator.
  const baseChromeHeight = input.sideRail || !input.showProcessList ? 2 : 3;
  const fixedChromeHeight = queryActive ? baseChromeHeight - 1 : baseChromeHeight;
  const logPaneHeight = Math.max(
    1,
    input.height - processPaneHeight - queryHeight - fixedChromeHeight,
  );
  const canFocusProcesses = input.sideRail || input.showProcessList;
  const focusedPane = canFocusProcesses ? input.focusedPane : "logs";
  const visibleLogs = filterLogs(
    input.snapshot.logs,
    input.viewId,
    input.filterText,
    input.logLevel,
  );
  const unfilteredViewLogs = filterLogs(input.snapshot.logs, input.viewId, "", input.logLevel);
  const searchMatches =
    input.searchText.trim().length === 0
      ? []
      : visibleLogs.filter((log) => logMatchesQuery(log, input.searchText));
  const unconstrainedRows = buildDisplayRows(visibleLogs, input.logWidth);
  const hasScrollbar = unconstrainedRows.length > logPaneHeight;
  const displayRows = hasScrollbar
    ? buildDisplayRows(visibleLogs, Math.max(1, input.logWidth - 1))
    : unconstrainedRows;
  const maxScrollStartIndex = Math.max(0, displayRows.length - logPaneHeight);
  const scrollStartIndex =
    input.logAnchorId === null
      ? maxScrollStartIndex
      : indexForAnchor(
          displayRows,
          input.logAnchorId,
          input.logAnchorLineIndex,
          maxScrollStartIndex,
        );
  const scrollEndIndex = Math.min(displayRows.length, scrollStartIndex + logPaneHeight);
  const logRows = displayRows.slice(scrollStartIndex, scrollEndIndex);
  const selectedLog =
    input.selectedLogId === null
      ? focusedPane === "logs"
        ? (logRows[logRows.length - 1]?.log ?? null)
        : null
      : (displayRows.find(
          (row) =>
            row.log.id === input.selectedLogId && row.lineIndex === input.selectedLogLineIndex,
        )?.log ??
        visibleLogs.find((log) => log.id === input.selectedLogId) ??
        null);
  const selectedSearchMatchZeroIndex =
    selectedLog === null ? -1 : searchMatches.findIndex((log) => log.id === selectedLog.id);
  const selectedSearchMatchIndex =
    selectedSearchMatchZeroIndex >= 0 ? selectedSearchMatchZeroIndex + 1 : null;

  const selectedLogIds = resolveSelectedLogIds(
    displayRows,
    input.markedLogIds,
    input.visualAnchorId === null
      ? null
      : { id: input.visualAnchorId, lineIndex: input.visualAnchorLineIndex },
    { id: input.selectedLogId, lineIndex: input.selectedLogLineIndex },
  );

  return {
    activeLabel: activeLabel(input.snapshot.processes, input.viewId),
    visibleLogs,
    scrollRows: displayRows,
    logRows,
    processPaneHeight,
    logPaneHeight,
    scrollStartIndex,
    scrollEndIndex,
    maxScrollStartIndex,
    isFollowing: input.logAnchorId === null,
    focusedPane,
    canFocusProcesses,
    selectedLog,
    selectedLogIds,
    selectionCount: selectedLogIds.size,
    visualMode: input.visualAnchorId !== null,
    filteredCount: visibleLogs.length,
    hiddenLogCount: Math.max(0, unfilteredViewLogs.length - visibleLogs.length),
    searchMatchCount: searchMatches.length,
    selectedSearchMatchIndex,
    displayRowCount: displayRows.length,
    scrollbar: buildScrollbar(
      displayRows.length,
      logPaneHeight,
      scrollStartIndex,
      maxScrollStartIndex,
    ),
  };
};
