import { describe, expect, test } from "bun:test";
import type { LogEntry, RunnerSnapshot } from "../core/domain.ts";
import { buildViewModel } from "./model.ts";

const log = (input: Partial<LogEntry> & Pick<LogEntry, "id" | "text">): LogEntry => ({
  processId: "api",
  processName: "api",
  stream: "stdout",
  severity: "info",
  timestampMs: 1,
  ...input,
});

const snapshot = (logs: readonly LogEntry[]): RunnerSnapshot => ({
  processes: [],
  logs,
});

const build = (
  logs: readonly LogEntry[],
  overrides: Partial<Parameters<typeof buildViewModel>[0]> = {},
) =>
  buildViewModel({
    snapshot: snapshot(logs),
    viewId: "merged",
    filterText: "",
    logLevel: "all",
    filterMode: false,
    showProcessList: false,
    sideRail: false,
    logAnchorId: null,
    logAnchorLineIndex: 0,
    selectedLogId: null,
    selectedLogLineIndex: 0,
    markedLogIds: [],
    visualAnchorId: null,
    visualAnchorLineIndex: 0,
    focusedPane: "logs",
    height: 8,
    logWidth: 31,
    nameColWidth: 8,
    ...overrides,
  });

describe("buildViewModel log wrapping", () => {
  test("wraps long logs into visual rows", () => {
    const view = build([log({ id: 1, text: "abcdefghijkl" })]);

    expect(view.logRows.map((row) => row.text)).toEqual(["abcde", "fghij", "kl"]);
    expect(view.scrollRows.map((row) => [row.log.id, row.lineIndex, row.totalLines])).toEqual([
      [1, 0, 3],
      [1, 1, 3],
      [1, 2, 3],
    ]);
  });

  test("anchors scrolling to a visual row inside a wrapped log", () => {
    const view = build([log({ id: 1, text: "abcdefghijklmnop" })], {
      height: 7,
      logAnchorId: 1,
      logAnchorLineIndex: 1,
    });

    expect(view.scrollStartIndex).toBe(1);
    expect(view.logRows.map((row) => row.lineIndex)).toEqual([1, 2]);
  });

  test("keeps filtering and selection mapped to source log entries", () => {
    const source = log({ id: 1, text: "abcdef needle ghijkl" });
    const view = build([source], {
      filterText: "needle",
      selectedLogId: 1,
      selectedLogLineIndex: 1,
    });

    expect(view.visibleLogs).toEqual([source]);
    expect(view.selectedLog).toBe(source);
  });
});
