import { RGBA, TextAttributes, type MouseEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardRuntime } from "./core/clipboard.ts";
import type { ProcessRunner } from "./core/runner.ts";
import type { DevtuiConfig, LogEntry, ProcessRuntime, RunnerSnapshot } from "./core/domain.ts";
import { formatTime, pad, truncate } from "./core/text.ts";
import { colors, rgba, setActiveTheme, themeNamesMatching, type ThemeName } from "./theme.ts";
import {
  keyboardKeyFromInputSequence,
  reduceKeyboard,
  reduceLogScroll,
  type KeyboardKey,
  type UiCommand,
} from "./ui/keyboard.ts";
import {
  buildViewModel,
  logMetaWidth,
  LOG_DIVIDER,
  LOG_STREAM_WIDTH,
  LOG_TIME_WIDTH,
  type LogDisplayRow,
  type ScrollbarModel,
} from "./ui/model.ts";
import {
  focusedPaneAtom,
  filterModeAtom,
  filterTextAtom,
  helpOpenAtom,
  logAnchorIdAtom,
  logAnchorLineIndexAtom,
  logLevelAtom,
  markedLogIdsAtom,
  processPickerOpenAtom,
  selectedLogIdAtom,
  selectedLogLineIndexAtom,
  themeFilterTextAtom,
  themeNameAtom,
  themePickerOpenAtom,
  themeScrollIndexAtom,
  visualAnchorIdAtom,
  visualAnchorLineIndexAtom,
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
      return colors.red;
  }
};

// A non-zero exit reads as a crash, so surface the code inline (`exited(1)`).
const statusLabel = (process: ProcessRuntime) =>
  process.status === "exited" && process.exitCode !== null
    ? `exited(${process.exitCode})`
    : process.status;

const isCrashed = (process: ProcessRuntime | undefined): process is ProcessRuntime =>
  process !== undefined && (process.status === "exited" || process.status === "failed");

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

const streamColor = (log: LogEntry) =>
  log.stream === "stderr" ? colors.red : log.stream === "system" ? colors.violet : colors.muted;

const nameColumnWidth = (processes: readonly ProcessRuntime[]) => {
  const longest = processes.reduce((max, process) => Math.max(max, process.spec.name.length), 0);
  return clamp(longest, 3, 12);
};

const leftPad = (input: string, width: number) => truncate(input, width).padStart(width);

// The dim metadata gutter (`HH:MM:SS  name  lvl │`) shown to the left of every
// log message. Continuation rows blank the metadata but keep the divider so
// wrapped text stays visually attached to its entry.
type DividerStyle = "normal" | "selected" | "copied";

// The 3-column divider between metadata and message doubles as a status glyph,
// all the same width as " │ " so nothing reflows: a green check on a just-copied
// entry, an accent bar on a selected/marked one, otherwise the dim separator.
const DividerGlyph = ({ style }: { readonly style: DividerStyle }) => {
  if (style === "copied")
    return (
      <span fg={colors.green} attributes={TextAttributes.BOLD}>
        {" ✓ "}
      </span>
    );
  if (style === "selected")
    return (
      <span fg={colors.accent} attributes={TextAttributes.BOLD}>
        {" ┃ "}
      </span>
    );
  return <span fg={colors.separator}>{LOG_DIVIDER}</span>;
};

const LogMeta = ({
  log,
  nameWidth,
  continuation,
  dividerStyle,
}: {
  readonly log: LogEntry;
  readonly nameWidth: number;
  readonly continuation: boolean;
  readonly dividerStyle: DividerStyle;
}) => {
  if (continuation) {
    const blank = " ".repeat(LOG_TIME_WIDTH + 1 + nameWidth + 1 + LOG_STREAM_WIDTH);
    // The check only marks the first row of an entry; wrapped rows fall back to
    // the plain divider (or the selected bar when the entry is selected).
    return (
      <>
        <span fg={colors.separator}>{blank}</span>
        <DividerGlyph style={dividerStyle === "copied" ? "normal" : dividerStyle} />
      </>
    );
  }
  return (
    <>
      <span fg={colors.dim}>{formatTime(log.timestampMs)} </span>
      <span fg={colors.muted}>{pad(log.processName, nameWidth)} </span>
      <span fg={streamColor(log)}>{logStreamLabel(log)}</span>
      <DividerGlyph style={dividerStyle} />
    </>
  );
};

// Transient highlight shown on the log rows right after their text is copied.
// `stage` steps from a brighter green to a dimmer one so the flash fades out.
interface CopyFlash {
  readonly ids: ReadonlySet<number>;
  readonly stage: 0 | 1;
}

type Hint = readonly [key: string, label: string];

// Renders `<key> label` pairs with the key highlighted and groups separated by
// breathing room, so the footer hints read as discrete shortcuts.
const hintSpans = (hints: readonly Hint[]) =>
  hints.flatMap(([key, label], index) => [
    <span key={`gap-${index}`} fg={colors.separator}>
      {index === 0 ? "" : "   "}
    </span>,
    <span key={`key-${index}`} fg={colors.green} attributes={TextAttributes.BOLD}>
      {key}
    </span>,
    <span key={`label-${index}`} fg={colors.muted}>
      {" "}
      {label}
    </span>,
  ]);

const modalHintSpans = (hints: readonly Hint[]) =>
  hints.flatMap(([key, label], index) => [
    <span key={`gap-${index}`} fg={colors.separator}>
      {index === 0 ? "" : "  "}
    </span>,
    <span key={`key-${index}`} fg={colors.green} attributes={TextAttributes.BOLD}>
      {key}
    </span>,
    <span key={`label-${index}`} fg={colors.muted}>
      {` ${label}`}
    </span>,
  ]);

const Divider = ({
  width,
  solid = false,
}: {
  readonly width: number;
  readonly solid?: boolean;
}) => (
  <box height={1}>
    <text fg={colors.separator} wrapMode="none" truncate>
      {(solid ? "─" : "╌").repeat(Math.max(1, width))}
    </text>
  </box>
);

const SeparatorColumn = ({ height }: { readonly height: number }) => (
  <box width={1} height={height}>
    {Array.from({ length: Math.max(0, height) }, (_, index) => (
      <text key={index} fg={colors.separator} wrapMode="none">
        │
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
  width,
  showHelp,
}: {
  readonly processes: readonly ProcessRuntime[];
  readonly viewId: string;
  readonly width: number;
  readonly showHelp: boolean;
}) => {
  const compact = width < 48;
  const indexWidth = Math.max(1, String(processes.length).length);
  const statusWidth = processes.reduce((max, process) => {
    return Math.max(max, statusLabel(process).length);
  }, 8);
  const linesWidth = Math.max(
    5,
    processes.reduce((max, process) => Math.max(max, String(process.lineCount).length), 0),
  );
  const errorWidth = Math.max(
    3,
    processes.reduce((max, process) => Math.max(max, String(process.errorCount || ".").length), 0),
  );
  const portWidth = width >= 38 ? 6 : 0;
  const textWidth = Math.max(1, width - 2);
  const fixedTextWidth =
    indexWidth + statusWidth + linesWidth + errorWidth + portWidth + (portWidth > 0 ? 7 : 6);
  const nameWidth = Math.max(
    compact ? 5 : 7,
    Math.min(compact ? 12 : 18, textWidth - fixedTextWidth),
  );
  const mergedSelected = viewId === "merged";
  const mergedLabel = compact ? "all logs" : "all processes, combined";
  const mergedGap = Math.max(1, indexWidth + 1);
  return (
    <box flexDirection="column" width={width}>
      <box
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={mergedSelected ? rgba(colors.selectedBg) : undefined}
      >
        <text wrapMode="none" truncate>
          <span fg={mergedSelected ? colors.accent : colors.muted}>
            {mergedSelected ? "> " : "  "}
            {" ".repeat(mergedGap)}
          </span>
          <span
            fg={mergedSelected ? colors.selectedText : colors.text}
            attributes={TextAttributes.BOLD}
          >
            {pad("merged", nameWidth)}
          </span>
          <span fg={colors.dim}>
            {"  "}
            {mergedLabel}
          </span>
        </text>
      </box>
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" truncate>
          <span fg={colors.dim}>
            {"  "}
            {leftPad("#", indexWidth)} {pad("process", nameWidth)} {pad("status", statusWidth)}{" "}
            {leftPad("lines", linesWidth)} {leftPad("err", errorWidth)}
            {portWidth > 0 ? ` ${leftPad("port", portWidth)}` : ""}
          </span>
        </text>
      </box>
      <Divider width={width} solid />
      {processes.map((process, index) => {
        const selected = viewId === process.id;
        const port = process.endpoints[0]?.port;
        const hasPort = port !== undefined;
        const errorText = process.errorCount > 0 ? String(process.errorCount) : ".";
        return (
          <box
            key={process.id}
            height={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
          >
            <text wrapMode="none" truncate>
              <span fg={selected ? colors.accent : colors.muted}>
                {selected ? "> " : "  "}
                {leftPad(String(index + 1), indexWidth)}{" "}
              </span>
              <span fg={selected ? colors.selectedText : colors.text}>
                {pad(process.spec.name, nameWidth)}{" "}
              </span>
              <span fg={statusColor(process.status)} attributes={TextAttributes.BOLD}>
                {pad(statusLabel(process), statusWidth)}{" "}
              </span>
              <span fg={selected ? colors.selectedText : colors.dim}>
                {leftPad(String(process.lineCount), linesWidth)}{" "}
              </span>
              <span
                fg={
                  process.errorCount > 0
                    ? colors.yellow
                    : selected
                      ? colors.selectedText
                      : colors.dim
                }
                attributes={process.errorCount > 0 ? TextAttributes.BOLD : undefined}
              >
                {leftPad(errorText, errorWidth)}
              </span>
              {portWidth > 0 ? (
                <>
                  <span fg={colors.dim}> </span>
                  <span
                    fg={hasPort ? (selected ? colors.selectedText : colors.accent) : colors.dim}
                  >
                    {leftPad(hasPort ? `:${port}` : ".", portWidth)}
                  </span>
                </>
              ) : null}
            </text>
          </box>
        );
      })}
      {showHelp ? (
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text wrapMode="none" truncate>
            {hintSpans([
              ["h/l", "focus"],
              ["j/k", "select"],
              ["p", "picker"],
              ["/", "filter"],
              ["L", "level"],
              ["t", "theme"],
            ])}
          </text>
        </box>
      ) : null}
    </box>
  );
};

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
  const hint = filterText ? "enter apply · esc cancel" : "type to filter logs · esc cancel";
  const query = truncate(filterText, Math.max(1, width - hint.length - 8));
  return (
    <box
      height={1}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={rgba(colors.selectedBg)}
    >
      <box flexDirection="row">
        <text wrapMode="none">
          <span fg={colors.accent} attributes={TextAttributes.BOLD}>
            {"/ "}
          </span>
          <span fg={colors.text}>{query}</span>
          <span fg={colors.text} attributes={TextAttributes.INVERSE}>
            {" "}
          </span>
        </text>
      </box>
      <box flexGrow={1} />
      <text wrapMode="none">
        <span fg={colors.dim}>{hint}</span>
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
  nameWidth,
  selectedLogId,
  selectedLogLineIndex,
  selectedLogIds,
  copyFlash,
  onScroll,
}: {
  readonly rows: readonly LogDisplayRow[];
  readonly width: number;
  readonly height: number;
  readonly scrollbar: ScrollbarModel | null;
  readonly focused: boolean;
  readonly nameWidth: number;
  readonly selectedLogId: number | null;
  readonly selectedLogLineIndex: number;
  readonly selectedLogIds: ReadonlySet<number>;
  readonly copyFlash: CopyFlash | null;
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
        const continuation = row.lineIndex !== 0;
        const textWidth = Math.max(1, logPaneWidth - logMetaWidth(nameWidth) - 2);
        const cursor =
          focused &&
          ((selectedLogId === log.id && selectedLogLineIndex === row.lineIndex) ||
            (selectedLogId === null && index === visibleRows.length - 1));
        const flashStage = copyFlash && copyFlash.ids.has(log.id) ? copyFlash.stage : null;
        const flashed = flashStage !== null;
        const inSelection = selectedLogIds.has(log.id);
        const highlighted = cursor || inSelection;
        const background =
          flashStage !== null
            ? rgba(flashStage === 0 ? colors.copyFlashBg : colors.copyFlashBgDim)
            : highlighted
              ? rgba(colors.selectedBg)
              : undefined;
        const dividerStyle: DividerStyle = flashed ? "copied" : inSelection ? "selected" : "normal";
        const segments = log.ansiText
          ? (parseAnsiWrappedLines(log.ansiText, textWidth)[row.lineIndex] ?? [{ text: row.text }])
          : [{ text: row.text }];
        return (
          <box
            key={`${log.id}-${row.lineIndex}`}
            height={1}
            flexDirection="row"
            width={width}
            backgroundColor={background}
            onMouseScroll={onScroll}
          >
            <box
              width={logPaneWidth}
              height={1}
              paddingLeft={1}
              paddingRight={hasScrollbar ? 0 : 1}
            >
              <text wrapMode="none" truncate>
                <LogMeta
                  log={log}
                  nameWidth={nameWidth}
                  continuation={continuation}
                  dividerStyle={dividerStyle}
                />
                {segments.map((segment, segmentIndex) => (
                  <span
                    key={segmentIndex}
                    fg={
                      highlighted
                        ? (segment.fg ?? colors.selectedText)
                        : (segment.fg ?? logColor(log))
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
          <span fg={colors.separator}>{"   "}</span>
          {hintSpans([
            ["j/k", "select"],
            ["enter", "close"],
          ])}
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
        <text wrapMode="none" truncate>
          {hintSpans([
            ["m", "merged"],
            ["1-9", "jump"],
            ["esc", "close"],
          ])}
        </text>
      </box>
    </box>
  );
};

// Keybinding reference shown by the `?` overlay. Kept in sync with the reducer
// in ui/keyboard.ts so the help never advertises shortcuts that don't exist.
const HELP_KEYS: readonly (readonly [string, string])[] = [
  ["j / k", "move selection down / up"],
  ["h / l", "focus processes / logs"],
  ["1-9", "jump to process by number"],
  ["m", "merged view"],
  ["tab", "cycle process views"],
  ["/", "filter logs"],
  ["L", "cycle level: all → out → err"],
  ["x", "mark row (logs) · stop process"],
  ["V", "visual select range"],
  ["c / y", "copy selection"],
  ["C", "clear log buffer"],
  ["r / R", "restart process / restart all"],
  ["t", "choose theme"],
  ["?", "toggle this help"],
  ["q", "quit (press twice to confirm)"],
];

const HelpOverlay = ({
  width,
  height,
  processCount,
}: {
  readonly width: number;
  readonly height: number;
  readonly processCount: number;
}) => {
  const keyColumn = HELP_KEYS.reduce((max, [key]) => Math.max(max, key.length), 0);
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={width}
      height={height}
      backgroundColor={RGBA.fromValues(0, 0, 0, 0.45)}
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="rounded"
        borderColor={colors.separator}
        backgroundColor={rgba(colors.panelBg)}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <box height={1}>
          <text wrapMode="none">
            <span fg={colors.accent} attributes={TextAttributes.BOLD}>
              devtui · keys
            </span>
          </text>
        </box>
        <box height={1} />
        {HELP_KEYS.map(([key, description]) => (
          <box key={key} height={1}>
            <text wrapMode="none">
              <span fg={colors.green} attributes={TextAttributes.BOLD}>
                {pad(key, keyColumn)}
              </span>
              <span fg={colors.muted}>
                {"   "}
                {description}
              </span>
            </text>
          </box>
        ))}
        <box height={1} />
        <box height={1}>
          <text wrapMode="none">
            <span fg={colors.dim}>
              {processCount} {processCount === 1 ? "process" : "processes"} · ? or esc to close
            </span>
          </text>
        </box>
      </box>
    </box>
  );
};

const ThemeSelectorOverlay = ({
  width,
  height,
  themeName,
  query,
  scrollIndex,
}: {
  readonly width: number;
  readonly height: number;
  readonly themeName: ThemeName;
  readonly query: string;
  readonly scrollIndex: number;
}) => {
  const rows = themeNamesMatching(query);
  const modalMaxWidth = Math.max(1, width - 4);
  const modalMinWidth = Math.min(36, modalMaxWidth);
  const modalWidth = clamp(Math.floor(width * 0.86), modalMinWidth, Math.min(88, modalMaxWidth));
  const modalMaxHeight = Math.max(1, height - 2);
  const modalMinHeight = Math.min(9, modalMaxHeight);
  const modalHeight = clamp(
    9 + Math.min(rows.length, 8),
    modalMinHeight,
    Math.min(20, modalMaxHeight),
  );
  const listHeight = Math.max(1, modalHeight - 8);
  const maxScrollIndex = Math.max(0, rows.length - listHeight);
  const startIndex = Math.max(0, Math.min(scrollIndex, maxScrollIndex));
  const visibleRows = rows.slice(startIndex, startIndex + listHeight);
  const innerWidth = Math.max(1, modalWidth - 4);
  const titleGap = Math.max(1, innerWidth - "Themes".length - "esc".length);
  const searchText = truncate(query || "Search", Math.max(1, innerWidth - 2));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={width}
      height={height}
      backgroundColor={RGBA.fromValues(0, 0, 0, 0.55)}
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={modalWidth}
        height={modalHeight}
        flexDirection="column"
        backgroundColor={rgba(colors.panelBg)}
      >
        <box height={1} />
        <box height={1} paddingLeft={2} paddingRight={2}>
          <text wrapMode="none" truncate>
            <span fg={colors.text} attributes={TextAttributes.BOLD}>
              Themes
            </span>
            <span fg={colors.separator}>{" ".repeat(titleGap)}</span>
            <span fg={colors.muted}>esc</span>
          </text>
        </box>
        <box height={1} />
        <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={rgba(colors.selectedBg)}>
          <text wrapMode="none" truncate>
            <span fg={query ? colors.text : colors.muted}>{searchText}</span>
            <span fg={colors.text} attributes={TextAttributes.INVERSE}>
              {" "}
            </span>
          </text>
        </box>
        <box height={1} />
        <box height={listHeight} flexDirection="column">
          {visibleRows.length === 0 ? (
            <box height={1} paddingLeft={2} paddingRight={2}>
              <text wrapMode="none" truncate>
                <span fg={colors.dim}>no themes found</span>
              </text>
            </box>
          ) : (
            visibleRows.map((name) => {
              const selected = name === themeName;
              return (
                <box
                  key={name}
                  height={1}
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
                >
                  <text wrapMode="none" truncate>
                    <span fg={selected ? colors.selectedText : colors.accent}>
                      {selected ? "● " : "  "}
                    </span>
                    <span
                      fg={selected ? colors.selectedText : colors.text}
                      attributes={selected ? TextAttributes.BOLD : undefined}
                    >
                      {name}
                    </span>
                  </text>
                </box>
              );
            })
          )}
        </box>
        <box height={1} />
        <box height={1} paddingLeft={2} paddingRight={2}>
          <text wrapMode="none" truncate>
            {modalHintSpans([
              ["j/k", "select"],
              ["type", "search"],
              ["enter", "close"],
            ])}
          </text>
        </box>
        <box height={1} />
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
    case "restartAll":
      // Handled in applyKeyboard where the live process list is available.
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
  initialThemeName,
}: {
  readonly config: DevtuiConfig;
  readonly clipboard: ClipboardRuntime;
  readonly runner: ProcessRunner;
  readonly initialThemeName: ThemeName;
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
  const [markedLogIds, setMarkedLogIds] = useAtom(markedLogIdsAtom);
  const [visualAnchorId, setVisualAnchorId] = useAtom(visualAnchorIdAtom);
  const [visualAnchorLineIndex, setVisualAnchorLineIndex] = useAtom(visualAnchorLineIndexAtom);
  const [helpOpen, setHelpOpen] = useAtom(helpOpenAtom);
  const [themeName, setThemeName] = useAtom(themeNameAtom);
  const [themePickerOpen, setThemePickerOpen] = useAtom(themePickerOpenAtom);
  const [themeFilterText, setThemeFilterText] = useAtom(themeFilterTextAtom);
  const [themeScrollIndex, setThemeScrollIndex] = useAtom(themeScrollIndexAtom);
  const initialThemeApplied = useRef(false);
  useEffect(() => {
    if (initialThemeApplied.current) return;
    initialThemeApplied.current = true;
    setThemeName(initialThemeName);
  }, [initialThemeName, setThemeName]);
  setActiveTheme(themeName);
  const [copyFlash, setCopyFlash] = useState<CopyFlash | null>(null);
  const copyFlashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flashCopiedRows = (logIds: readonly number[]) => {
    const ids = new Set(logIds);
    copyFlashTimers.current.forEach(clearTimeout);
    copyFlashTimers.current = [
      setTimeout(() => setCopyFlash({ ids, stage: 1 }), 550),
      setTimeout(() => setCopyFlash(null), 950),
    ];
    setCopyFlash({ ids, stage: 0 });
  };
  useEffect(() => () => copyFlashTimers.current.forEach(clearTimeout), []);
  // Quitting is guarded by a confirm step: the first quit press arms a window,
  // a second one within it actually quits, and any other key (or the timeout)
  // disarms. The ref mirrors the state so the captured input handler sees the
  // latest value without being re-registered.
  const [quitArmed, setQuitArmed] = useState(false);
  const quitArmedRef = useRef(false);
  const quitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setQuitArm = (armed: boolean) => {
    quitArmedRef.current = armed;
    setQuitArmed(armed);
    if (quitTimer.current) clearTimeout(quitTimer.current);
    quitTimer.current = armed ? setTimeout(() => setQuitArm(false), 3000) : null;
  };
  useEffect(
    () => () => {
      if (quitTimer.current !== null) clearTimeout(quitTimer.current);
    },
    [],
  );
  const showSideRail = width >= 110 && height >= 18;
  const showTopProcesses = !showSideRail && width >= 72 && height >= 22;
  const processRailWidth = showSideRail ? clamp(Math.floor(width * 0.34), 38, 58) : width;
  const logPaneWidth = showSideRail ? Math.max(1, width - processRailWidth - 1) : width;
  const nameColWidth = nameColumnWidth(snapshot.processes);

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
    markedLogIds,
    visualAnchorId,
    visualAnchorLineIndex,
    helpOpen,
    themeName,
    themePickerOpen,
    themeFilterText,
    themeScrollIndex,
  };
  const themePickerListHeight = Math.max(
    1,
    clamp(
      9 + Math.min(themeNamesMatching(themeFilterText).length, 8),
      Math.min(9, Math.max(1, height - 2)),
      Math.min(20, Math.max(1, height - 2)),
    ) - 6,
  );
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
    nameColWidth,
    markedLogIds,
    visualAnchorId,
    visualAnchorLineIndex,
  });
  const stateRef = useRef({ state, snapshot, view, themePickerListHeight });
  stateRef.current = { state, snapshot, view, themePickerListHeight };

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
    setMarkedLogIds(nextState.markedLogIds);
    setVisualAnchorId(nextState.visualAnchorId);
    setVisualAnchorLineIndex(nextState.visualAnchorLineIndex);
    setHelpOpen(nextState.helpOpen);
    setThemeName(nextState.themeName);
    setThemePickerOpen(nextState.themePickerOpen);
    setThemeFilterText(nextState.themeFilterText);
    setThemeScrollIndex(nextState.themeScrollIndex);
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
      themePickerListHeight: current.themePickerListHeight,
    });

    applyUiState(result.state);

    if (result.command._tag === "quit") {
      // Ctrl+C is the deliberate hard-quit and bypasses the guard; a bare `q`
      // arms the confirm step instead.
      const forceQuit = key.ctrl && key.name === "c";
      if (forceQuit || quitArmedRef.current) {
        setQuitArm(false);
        runCommand(runner, clipboard, result.command);
        renderer.destroy();
        return;
      }
      setQuitArm(true);
      return;
    }

    if (quitArmedRef.current) setQuitArm(false);

    if (result.command._tag === "copyText") flashCopiedRows(result.command.logIds);

    if (result.command._tag === "restartAll") {
      current.snapshot.processes.forEach((process) =>
        Effect.runFork(runner.restartProcess(process.id)),
      );
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

  const activeProcess = snapshot.processes.find((process) => process.id === viewId);
  const crashed = isCrashed(activeProcess);

  const footerHints: readonly Hint[] = crashed
    ? [
        ["r", "restart"],
        ["R", "restart all"],
        ["q", "quit"],
      ]
    : view.selectionCount > 0
      ? [
          ["y", "copy"],
          ["x", "mark"],
          ["esc", "clear"],
          ["q", "quit"],
        ]
      : [
          ["c", "copy"],
          ["C", "clear"],
          ["t", "theme"],
          ["h/l", "focus"],
          ["q", "quit"],
        ];

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
        <box flexDirection="row" height={view.logPaneHeight}>
          <ProcessList
            processes={snapshot.processes}
            viewId={viewId}
            width={processRailWidth}
            showHelp={false}
          />
          <SeparatorColumn height={view.logPaneHeight} />
          <box flexDirection="column" width={Math.max(1, width - processRailWidth - 1)}>
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
                nameWidth={nameColWidth}
                selectedLogId={selectedLogId}
                selectedLogLineIndex={selectedLogLineIndex}
                selectedLogIds={view.selectedLogIds}
                copyFlash={copyFlash}
                onScroll={onLogScroll}
              />
            )}
          </box>
        </box>
      ) : (
        <>
          {showTopProcesses ? (
            <>
              <ProcessList processes={snapshot.processes} viewId={viewId} width={width} showHelp />
              <Divider width={width} />
            </>
          ) : null}
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
              nameWidth={nameColWidth}
              selectedLogId={selectedLogId}
              selectedLogLineIndex={selectedLogLineIndex}
              selectedLogIds={view.selectedLogIds}
              copyFlash={copyFlash}
              onScroll={onLogScroll}
            />
          )}
        </>
      )}
      <FilterLine filterMode={filterMode} filterText={filterText} width={width} />
      <Divider width={width} solid />
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" truncate>
          <span fg={colors.dim}>{view.focusedPane}</span>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={colors.dim}>theme </span>
          <span fg={colors.muted}>{themeName}</span>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={view.isFollowing ? colors.green : colors.muted}>
            {view.isFollowing
              ? "following"
              : `paused ${view.scrollStartIndex + 1}-${view.scrollEndIndex}/${view.displayRowCount}`}
          </span>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={colors.text}>{view.activeLabel}</span>
          {crashed && activeProcess ? (
            <>
              <span fg={colors.separator}>{"  "}</span>
              <span fg={colors.red} attributes={TextAttributes.BOLD}>
                {statusLabel(activeProcess)}
              </span>
            </>
          ) : view.selectionCount > 0 ? (
            <>
              <span fg={colors.separator}>{"  "}</span>
              <span fg={colors.accent} attributes={TextAttributes.BOLD}>
                {view.visualMode ? "visual " : ""}
                {view.selectionCount} selected
              </span>
            </>
          ) : (
            <>
              <span fg={colors.separator}>{"  "}</span>
              <span fg={colors.dim}>level </span>
              <span fg={colors.muted}>{logLevel}</span>
            </>
          )}
        </text>
        <box flexGrow={1} />
        <text wrapMode="none">
          {quitArmed ? (
            <span fg={colors.yellow} attributes={TextAttributes.BOLD}>
              press q again to quit
            </span>
          ) : (
            hintSpans(footerHints)
          )}
        </text>
      </box>
      {helpOpen ? (
        <HelpOverlay width={width} height={height} processCount={snapshot.processes.length} />
      ) : null}
      {themePickerOpen ? (
        <ThemeSelectorOverlay
          width={width}
          height={height}
          themeName={themeName}
          query={themeFilterText}
          scrollIndex={themeScrollIndex}
        />
      ) : null}
    </box>
  );
};
