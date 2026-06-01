import type { LogEntry, ProcessRuntime, RunnerSnapshot } from "../core/domain.ts";
import type { FocusedPane, LogLevelFilter } from "./state.ts";

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
  readonly logLevel: LogLevelFilter;
  readonly filterMode: boolean;
  readonly showProcessList: boolean;
  readonly sideRail: boolean;
  readonly logAnchorId: number | null;
  readonly logAnchorLineIndex: number;
  readonly selectedLogId: number | null;
  readonly selectedLogLineIndex: number;
  readonly focusedPane: FocusedPane;
  readonly height: number;
  readonly logWidth: number;
  readonly nameColWidth: number;
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
  readonly displayRowCount: number;
  readonly scrollbar: ScrollbarModel | null;
}

export interface ScrollbarModel {
  readonly thumbTop: number;
  readonly thumbHeight: number;
  readonly trackHeight: number;
}

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
export const LOG_STREAM_WIDTH = 3;
export const LOG_DIVIDER = " │ ";

/**
 * Width of the metadata gutter that precedes a log message:
 * `HH:MM:SS <name> lvl │ `. Kept in one place so the renderer and the
 * wrap calculation never drift apart.
 */
export const logMetaWidth = (nameColWidth: number) =>
  LOG_TIME_WIDTH + 1 + nameColWidth + 1 + LOG_STREAM_WIDTH + LOG_DIVIDER.length;

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
  nameColWidth: number,
): readonly LogDisplayRow[] => {
  const textWidth = Math.max(1, logPaneWidth - logMetaWidth(nameColWidth) - 2);
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
    ? Math.min(input.height - 5, input.snapshot.processes.length + 2)
    : 0;
  const filterHeight = input.filterMode ? 1 : 0;
  // Header (2) + header rule (1) + status rule (1) + status bar (1) = 5, plus a
  // second rule (1) under the top process list when it is shown.
  const fixedChromeHeight = input.sideRail || !input.showProcessList ? 5 : 6;
  const logPaneHeight = Math.max(
    1,
    input.height - processPaneHeight - filterHeight - fixedChromeHeight,
  );
  const canFocusProcesses = input.sideRail || input.showProcessList;
  const focusedPane = canFocusProcesses ? input.focusedPane : "logs";
  const visibleLogs = filterLogs(
    input.snapshot.logs,
    input.viewId,
    input.filterText,
    input.logLevel,
  );
  const unconstrainedRows = buildDisplayRows(visibleLogs, input.logWidth, input.nameColWidth);
  const hasScrollbar = unconstrainedRows.length > logPaneHeight;
  const displayRows = hasScrollbar
    ? buildDisplayRows(visibleLogs, Math.max(1, input.logWidth - 1), input.nameColWidth)
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
    displayRowCount: displayRows.length,
    scrollbar: buildScrollbar(
      displayRows.length,
      logPaneHeight,
      scrollStartIndex,
      maxScrollStartIndex,
    ),
  };
};
