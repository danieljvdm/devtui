import { describe, expect, test } from "bun:test";
import type { LogEntry, ProcessRuntime, RunnerSnapshot } from "../core/domain.ts";
import { buildLayoutModel, buildViewModel } from "./model.ts";

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

const process = (name: string, index: number): ProcessRuntime => ({
  id: name,
  spec: { name, command: `bun run ${name}` },
  status: "running",
  endpoints: [],
  pid: index + 1000,
  startedAtMs: 1,
  endedAtMs: null,
  exitCode: null,
  lineCount: 0,
  errorCount: 0,
});

const processes = ["web", "api", "worker"].map(process);

const build = (
  logs: readonly LogEntry[],
  overrides: Partial<Parameters<typeof buildViewModel>[0]> = {},
) =>
  buildViewModel({
    snapshot: snapshot(logs),
    viewId: "merged",
    filterText: "",
    searchText: "",
    logLevel: "all",
    filterMode: false,
    searchMode: false,
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
      height: 4,
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

  test("filter hides rows while search only reports matches", () => {
    const logs = [
      log({ id: 1, text: "GET /api/tasks 200" }),
      log({ id: 2, text: "GET /api/users 200" }),
      log({ id: 3, text: "POST /api/tasks 500" }),
    ];

    const filtered = build(logs, { filterText: "tasks" });
    expect(filtered.visibleLogs.map((entry) => entry.id)).toEqual([1, 3]);
    expect(filtered.hiddenLogCount).toBe(1);

    const searched = build(logs, { searchText: "tasks" });
    expect(searched.visibleLogs.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(searched.searchMatchCount).toBe(2);
  });
});

describe("buildLayoutModel", () => {
  test("uses a compact side rail at 80x24", () => {
    const layout = buildLayoutModel(80, 24, processes);
    expect(layout.showCompactSideRail).toBe(true);
    expect(layout.showAnySideRail).toBe(true);
    expect(layout.showTopProcesses).toBe(false);
    expect(layout.processRailWidth).toBe(16);
    expect(layout.logPaneWidth).toBe(63);
  });

  test("uses a content-sized full process rail at 110x30", () => {
    const layout = buildLayoutModel(110, 30, processes);
    expect(layout.showSideRail).toBe(true);
    expect(layout.processRailWidth).toBe(16);
    expect(layout.logPaneWidth).toBe(93);
  });

  test("does not grow the process rail just because the terminal is wide", () => {
    const layout = buildLayoutModel(220, 40, processes);
    expect(layout.showSideRail).toBe(true);
    expect(layout.processRailWidth).toBe(16);
    expect(layout.logPaneWidth).toBe(203);
  });

  test("caps long process names instead of using a percentage width", () => {
    const layout = buildLayoutModel(220, 40, [
      process("frontend-development-server", 0),
      process("api", 1),
    ]);
    expect(layout.processRailWidth).toBe(24);
    expect(layout.logPaneWidth).toBe(195);
  });

  test("falls back to log-first layout when the terminal is narrow or short", () => {
    const layout = buildLayoutModel(70, 16, processes);
    expect(layout.showAnySideRail).toBe(false);
    expect(layout.showTopProcesses).toBe(false);
    expect(layout.logPaneWidth).toBe(70);
  });
});
