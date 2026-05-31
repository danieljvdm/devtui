import { TextAttributes, type MouseEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useMemo, useRef } from "react";
import type { ClipboardRuntime } from "./core/clipboard.ts";
import type { ProcessRunner } from "./core/runner.ts";
import type { DevtuiConfig, LogEntry, ProcessRuntime, RunnerSnapshot } from "./core/domain.ts";
import { formatTime, pad, truncate } from "./core/text.ts";
import { colors, rgba } from "./theme.ts";
import {
  keyboardKeyFromInputSequence,
  reduceKeyboard,
  reduceLogScroll,
  type KeyboardKey,
  type UiCommand,
} from "./ui/keyboard.ts";
import { buildViewModel, type LogDisplayRow, type ScrollbarModel } from "./ui/model.ts";
import {
  focusedPaneAtom,
  filterModeAtom,
  filterTextAtom,
  logAnchorIdAtom,
  logAnchorLineIndexAtom,
  logLevelAtom,
  processPickerOpenAtom,
  selectedLogIdAtom,
  selectedLogLineIndexAtom,
  type LogLevelFilter,
  type UiState,
  viewIdAtom,
} from "./ui/state.ts";
import { parseAnsiWrappedLines } from "./ui/ansi.ts";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const statusColor = (status: ProcessRuntime["status"]) => {
  switch (status) {
    case "running":
      return colors.green;
    case "starting":
      return colors.yellow;
    case "failed":
      return colors.red;
    case "stopped":
      return colors.violet;
    case "exited":
      return colors.muted;
  }
};

const logColor = (log: LogEntry) => {
  switch (log.severity) {
    case "error":
      return colors.red;
    case "warn":
      return colors.yellow;
    case "system":
      return colors.violet;
    case "info":
      return colors.text;
  }
};

const logStreamLabel = (log: LogEntry) =>
  log.stream === "stderr" ? "err" : log.stream === "system" ? "sys" : "out";

const logPrefix = (log: LogEntry) =>
  `${formatTime(log.timestampMs)} ${pad(log.processName, 10)} ${logStreamLabel(log)} `;

const continuationPrefix = () => `${" ".repeat("00:00:00".length)} ${" ".repeat(10)}   | `;

const Divider = ({ width }: { readonly width: number }) => (
  <box height={1}>
    <text fg={colors.separator} wrapMode="none" truncate>
      {"-".repeat(Math.max(1, width))}
    </text>
  </box>
);

const SeparatorColumn = ({ height }: { readonly height: number }) => (
  <box width={1} height={height}>
    {Array.from({ length: Math.max(0, height) }, (_, index) => (
      <text key={index} fg={colors.separator} wrapMode="none">
        |
      </text>
    ))}
  </box>
);

const Header = ({
  title,
  width,
  activeLabel,
  filterText,
  logLevel,
}: {
  readonly title: string;
  readonly width: number;
  readonly activeLabel: string;
  readonly filterText: string;
  readonly logLevel: LogLevelFilter;
}) => {
  const filters = [
    filterText ? `filter: ${filterText}` : null,
    logLevel === "all" ? null : `level: ${logLevel}`,
  ].filter((value): value is string => value !== null);
  const right = filters.length > 0 ? filters.join(" | ") : activeLabel;
  const gap = Math.max(1, width - title.length - right.length - 4);
  return (
    <box height={2} paddingLeft={1} paddingRight={1} flexDirection="column">
      <box height={1} />
      <text wrapMode="none" truncate>
        <span fg={colors.accent} attributes={TextAttributes.BOLD}>
          {title}
        </span>
        <span fg={colors.muted}>{" ".repeat(gap)}</span>
        <span fg={filterText ? colors.yellow : colors.muted}>{right}</span>
      </text>
    </box>
  );
};

const ProcessList = ({
  processes,
  viewId,
  focused,
  width,
  showHelp,
}: {
  readonly processes: readonly ProcessRuntime[];
  readonly viewId: string;
  readonly focused: boolean;
  readonly width: number;
  readonly showHelp: boolean;
}) => (
  <box flexDirection="column" width={width}>
    <box height={1} paddingLeft={1} paddingRight={1}>
      <text wrapMode="none" truncate>
        <span
          fg={viewId === "merged" ? colors.selectedText : focused ? colors.accent : colors.muted}
          attributes={TextAttributes.BOLD}
        >
          {viewId === "merged" ? "> " : "  "}merged
        </span>
        <span fg={colors.dim}>{"  all process logs"}</span>
      </text>
    </box>
    {processes.map((process, index) => {
      const selected = viewId === process.id;
      const exit = process.exitCode === null ? "" : ` exit=${process.exitCode}`;
      const compact = width < 48;
      const nameWidth = compact ? Math.max(6, Math.min(12, width - 24)) : 14;
      const prefix = `${selected ? ">" : " "} ${index + 1} ${pad(process.spec.name, nameWidth)} `;
      const suffix = compact
        ? ` ${process.lineCount}l ${process.errorCount}e${process.endpoints[0]?.port ? ` :${process.endpoints[0].port}` : ""}${exit}`
        : ` pid=${process.pid ?? "-"} lines=${process.lineCount} errors=${process.errorCount}${
            process.endpoints[0]?.url ? ` ${process.endpoints[0].url}` : ""
          }${exit}`;
      return (
        <box
          key={process.id}
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
        >
          <text wrapMode="none" truncate>
            <span fg={selected ? colors.selectedText : colors.text}>{prefix}</span>
            <span fg={statusColor(process.status)} attributes={TextAttributes.BOLD}>
              {pad(process.status, 9)}
            </span>
            <span fg={selected ? colors.selectedText : colors.text}>
              {truncate(suffix, Math.max(1, width - prefix.length - 11))}
            </span>
          </text>
        </box>
      );
    })}
    {showHelp ? (
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={colors.dim} wrapMode="none" truncate>
          h/l or arrows focus j/k select p picker / text L level
        </text>
      </box>
    ) : null}
  </box>
);

const FilterLine = ({
  filterMode,
  filterText,
  width,
}: {
  readonly filterMode: boolean;
  readonly filterText: string;
  readonly width: number;
}) => {
  if (!filterMode) return null;
  const hint = filterText
    ? " enter apply  esc clear"
    : " type to filter logs  enter apply  esc clear";
  return (
    <box height={1} paddingLeft={1} paddingRight={1}>
      <text wrapMode="none" truncate fg={colors.accent}>
        /{truncate(filterText, Math.max(1, width - hint.length - 5))}
        <span fg={colors.accent}>_</span>
        <span fg={colors.muted}>{hint}</span>
      </text>
    </box>
  );
};

const LogRows = ({
  rows,
  width,
  height,
  scrollbar,
  focused,
  selectedLogId,
  selectedLogLineIndex,
  onScroll,
}: {
  readonly rows: readonly LogDisplayRow[];
  readonly width: number;
  readonly height: number;
  readonly scrollbar: ScrollbarModel | null;
  readonly focused: boolean;
  readonly selectedLogId: number | null;
  readonly selectedLogLineIndex: number;
  readonly onScroll: (event: MouseEvent) => void;
}) => {
  const visibleRows = rows.slice(0, Math.max(0, height));
  const hasScrollbar = scrollbar !== null;
  const logPaneWidth = hasScrollbar ? Math.max(1, width - 1) : width;
  const scrollbarChars = Array.from({ length: Math.max(0, height) }, (_, index) => {
    if (!scrollbar) return "";
    return index >= scrollbar.thumbTop && index < scrollbar.thumbTop + scrollbar.thumbHeight
      ? "#"
      : "|";
  });

  return (
    <box flexDirection="column" width={width} height={height} onMouseScroll={onScroll}>
      {Array.from({ length: Math.max(0, height) }, (_, index) => {
        const row = visibleRows[index];
        const scrollbarChar = scrollbarChars[index] ?? "|";

        if (!row) {
          return (
            <box
              key={`blank-${index}`}
              height={1}
              flexDirection="row"
              width={width}
              onMouseScroll={onScroll}
            >
              <box width={logPaneWidth} height={1} />
              {hasScrollbar ? (
                <text fg={colors.separator} wrapMode="none">
                  {scrollbarChar}
                </text>
              ) : null}
            </box>
          );
        }

        const log = row.log;
        const prefix = row.lineIndex === 0 ? logPrefix(log) : continuationPrefix();
        const textWidth = Math.max(1, logPaneWidth - prefix.length - 2);
        const selected =
          focused &&
          ((selectedLogId === log.id && selectedLogLineIndex === row.lineIndex) ||
            (selectedLogId === null && index === visibleRows.length - 1));
        const segments = log.ansiText
          ? (parseAnsiWrappedLines(log.ansiText, textWidth)[row.lineIndex] ?? [{ text: row.text }])
          : [{ text: row.text }];
        return (
          <box
            key={`${log.id}-${row.lineIndex}`}
            height={1}
            flexDirection="row"
            width={width}
            backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
            onMouseScroll={onScroll}
          >
            <box
              width={logPaneWidth}
              height={1}
              paddingLeft={1}
              paddingRight={hasScrollbar ? 0 : 1}
            >
              <text wrapMode="none" truncate>
                <span fg={colors.dim}>{prefix}</span>
                {segments.map((segment, segmentIndex) => (
                  <span
                    key={segmentIndex}
                    fg={
                      selected ? (segment.fg ?? colors.selectedText) : (segment.fg ?? logColor(log))
                    }
                    attributes={segment.attributes}
                  >
                    {segment.text}
                  </span>
                ))}
              </text>
            </box>
            {hasScrollbar ? (
              <text fg={scrollbarChar === "#" ? colors.accent : colors.separator} wrapMode="none">
                {scrollbarChar}
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
};

const ProcessPicker = ({
  processes,
  viewId,
  width,
  height,
}: {
  readonly processes: readonly ProcessRuntime[];
  readonly viewId: string;
  readonly width: number;
  readonly height: number;
}) => {
  const pickerWidth = width;
  const pickerHeight = height;
  const rows = [
    { id: "merged", label: "merged", detail: "all process logs" },
    ...processes.map((process, index) => ({
      id: process.id,
      label: `${index + 1} ${process.spec.name}`,
      detail: `${process.status} lines=${process.lineCount} errors=${process.errorCount}${
        process.endpoints[0]?.url ? ` ${process.endpoints[0].url}` : ""
      }`,
    })),
  ];

  return (
    <box
      width={pickerWidth}
      height={pickerHeight}
      flexDirection="column"
      backgroundColor={rgba(colors.screenBg)}
    >
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" truncate>
          <span fg={colors.accent} attributes={TextAttributes.BOLD}>
            processes
          </span>
          <span fg={colors.muted}> j/k select enter close</span>
        </text>
      </box>
      <Divider width={pickerWidth} />
      {rows.slice(0, Math.max(0, pickerHeight - 3)).map((row) => {
        const selected = row.id === viewId;
        return (
          <box
            key={row.id}
            height={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
          >
            <text wrapMode="none" truncate>
              <span fg={selected ? colors.selectedText : colors.text}>
                {selected ? "> " : "  "}
                {pad(row.label, 16)}
              </span>
              <span fg={colors.muted}>{truncate(row.detail, Math.max(1, pickerWidth - 22))}</span>
            </text>
          </box>
        );
      })}
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={colors.dim} wrapMode="none" truncate>
          m merged 1-9 jump esc close
        </text>
      </box>
    </box>
  );
};

const runCommand = (runner: ProcessRunner, clipboard: ClipboardRuntime, command: UiCommand) => {
  switch (command._tag) {
    case "none":
      return;
    case "clearLogs":
      Effect.runFork(runner.clearLogs);
      return;
    case "restartProcess":
      Effect.runFork(runner.restartProcess(command.id));
      return;
    case "copyText":
      Effect.runFork(clipboard.writeText(command.text).pipe(Effect.catchCause(() => Effect.void)));
      return;
    case "stopProcess":
      Effect.runFork(runner.stopProcess(command.id));
      return;
    case "quit":
      Effect.runFork(runner.stopAll);
      return;
  }
};

export const App = ({
  config,
  clipboard,
  runner,
}: {
  readonly config: DevtuiConfig;
  readonly clipboard: ClipboardRuntime;
  readonly runner: ProcessRunner;
}) => {
  const renderer = useRenderer();
  const { width = 100, height = 30 } = useTerminalDimensions();
  const snapshotAtom = useMemo(() => Atom.subscriptionRef(runner.snapshotRef), [runner]);
  const snapshot = useAtomValue(snapshotAtom) as RunnerSnapshot;
  const [viewId, setViewId] = useAtom(viewIdAtom);
  const [focusedPane, setFocusedPane] = useAtom(focusedPaneAtom);
  const [filterMode, setFilterMode] = useAtom(filterModeAtom);
  const [filterText, setFilterText] = useAtom(filterTextAtom);
  const [logLevel, setLogLevel] = useAtom(logLevelAtom);
  const [processPickerOpen, setProcessPickerOpen] = useAtom(processPickerOpenAtom);
  const [logAnchorId, setLogAnchorId] = useAtom(logAnchorIdAtom);
  const [logAnchorLineIndex, setLogAnchorLineIndex] = useAtom(logAnchorLineIndexAtom);
  const [selectedLogId, setSelectedLogId] = useAtom(selectedLogIdAtom);
  const [selectedLogLineIndex, setSelectedLogLineIndex] = useAtom(selectedLogLineIndexAtom);
  const showSideRail = width >= 110 && height >= 18;
  const showTopProcesses = !showSideRail && width >= 72 && height >= 22;
  const processRailWidth = showSideRail ? clamp(Math.floor(width * 0.28), 28, 42) : width;
  const logPaneWidth = showSideRail ? Math.max(1, width - processRailWidth - 1) : width;

  const state: UiState = {
    viewId,
    focusedPane,
    filterMode,
    filterText,
    logLevel,
    processPickerOpen,
    logAnchorId,
    logAnchorLineIndex,
    selectedLogId,
    selectedLogLineIndex,
  };
  const view = buildViewModel({
    snapshot,
    viewId,
    filterText,
    logLevel,
    filterMode,
    showProcessList: showTopProcesses,
    sideRail: showSideRail,
    logAnchorId,
    logAnchorLineIndex,
    selectedLogId,
    selectedLogLineIndex,
    focusedPane,
    height,
    logWidth: logPaneWidth,
  });
  const stateRef = useRef({ state, snapshot, view });
  stateRef.current = { state, snapshot, view };

  const applyUiState = (nextState: UiState) => {
    setViewId(nextState.viewId);
    setFocusedPane(nextState.focusedPane);
    setFilterMode(nextState.filterMode);
    setFilterText(nextState.filterText);
    setLogLevel(nextState.logLevel);
    setProcessPickerOpen(nextState.processPickerOpen);
    setLogAnchorId(nextState.logAnchorId);
    setLogAnchorLineIndex(nextState.logAnchorLineIndex);
    setSelectedLogId(nextState.selectedLogId);
    setSelectedLogLineIndex(nextState.selectedLogLineIndex);
  };

  const applyKeyboard = (key: KeyboardKey) => {
    const current = stateRef.current;
    const result = reduceKeyboard(key, current.state, current.snapshot.processes, {
      canFocusProcesses: current.view.canFocusProcesses,
      selectedLog: current.view.selectedLog,
      scroll: {
        visibleRows: current.view.scrollRows,
        startIndex: current.view.scrollStartIndex,
        maxStartIndex: current.view.maxScrollStartIndex,
        paneHeight: current.view.logPaneHeight,
      },
    });

    applyUiState(result.state);

    if (result.command._tag === "quit") {
      runCommand(runner, clipboard, result.command);
      renderer.destroy();
      return;
    }

    runCommand(runner, clipboard, result.command);
  };

  useEffect(() => {
    const handleInput = (sequence: string) => {
      const key = keyboardKeyFromInputSequence(sequence);
      if (!key) return false;
      applyKeyboard(key);
      return true;
    };

    renderer.prependInputHandler(handleInput);
    return () => renderer.removeInputHandler(handleInput);
  }, [renderer, runner, clipboard]);

  useKeyboard((key: KeyboardKey) => {
    applyKeyboard(key);
  });

  const onLogScroll = (event: MouseEvent) => {
    if (!event.scroll) return;
    const direction = event.scroll.direction;
    if (direction !== "up" && direction !== "down") return;

    event.preventDefault();
    event.stopPropagation();

    const current = stateRef.current;
    const delta = Math.max(1, Math.ceil(event.scroll.delta));
    const nextState = reduceLogScroll(
      current.state,
      {
        visibleRows: current.view.scrollRows,
        startIndex: current.view.scrollStartIndex,
        maxStartIndex: current.view.maxScrollStartIndex,
        paneHeight: current.view.logPaneHeight,
      },
      direction === "up" ? -delta : delta,
    );
    applyUiState(nextState);
  };

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      backgroundColor={rgba(colors.screenBg)}
    >
      <Header
        title={config.title ?? "devtui"}
        width={width}
        activeLabel={view.activeLabel}
        filterText={filterText}
        logLevel={logLevel}
      />
      <Divider width={width} />
      {showSideRail ? (
        <box flexDirection="row" height={Math.max(1, height - 4)}>
          <ProcessList
            processes={snapshot.processes}
            viewId={viewId}
            focused={view.focusedPane === "processes"}
            width={processRailWidth}
            showHelp={false}
          />
          <SeparatorColumn height={Math.max(1, height - 4)} />
          <box flexDirection="column" width={Math.max(1, width - processRailWidth - 1)}>
            <FilterLine
              filterMode={filterMode}
              filterText={filterText}
              width={Math.max(1, width - processRailWidth - 1)}
            />
            {processPickerOpen ? (
              <ProcessPicker
                processes={snapshot.processes}
                viewId={viewId}
                width={Math.max(1, width - processRailWidth - 1)}
                height={view.logPaneHeight}
              />
            ) : (
              <LogRows
                rows={view.logRows}
                width={Math.max(1, width - processRailWidth - 1)}
                height={view.logPaneHeight}
                scrollbar={view.scrollbar}
                focused={view.focusedPane === "logs"}
                selectedLogId={selectedLogId}
                selectedLogLineIndex={selectedLogLineIndex}
                onScroll={onLogScroll}
              />
            )}
          </box>
        </box>
      ) : (
        <>
          {showTopProcesses ? (
            <>
              <ProcessList
                processes={snapshot.processes}
                viewId={viewId}
                focused={view.focusedPane === "processes"}
                width={width}
                showHelp
              />
              <Divider width={width} />
            </>
          ) : null}
          <FilterLine filterMode={filterMode} filterText={filterText} width={width} />
          {processPickerOpen ? (
            <ProcessPicker
              processes={snapshot.processes}
              viewId={viewId}
              width={width}
              height={view.logPaneHeight}
            />
          ) : (
            <LogRows
              rows={view.logRows}
              width={width}
              height={view.logPaneHeight}
              scrollbar={view.scrollbar}
              focused={view.focusedPane === "logs"}
              selectedLogId={selectedLogId}
              selectedLogLineIndex={selectedLogLineIndex}
              onScroll={onLogScroll}
            />
          )}
        </>
      )}
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" truncate fg={colors.muted}>
          {view.focusedPane}{" "}
          {view.isFollowing
            ? "following"
            : `paused ${view.scrollStartIndex + 1}-${view.scrollEndIndex}/${view.displayRowCount}`}{" "}
          {view.activeLabel} level {logLevel} c copy C clear h/l arrows focus q quit
        </text>
      </box>
    </box>
  );
};
