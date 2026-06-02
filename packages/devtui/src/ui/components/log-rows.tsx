import { TextAttributes, type MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";
import type { LogEntry } from "../../core/domain.ts";
import { formatTime, pad } from "../../core/text.ts";
import { colors, rgba } from "../../theme.ts";
import { parseAnsiWrappedLines } from "../ansi.ts";
import {
  logMetaWidth,
  LOG_DIVIDER,
  LOG_STREAM_WIDTH,
  LOG_TIME_WIDTH,
  type LogDisplayRow,
  type ScrollbarModel,
} from "../model.ts";

// The dim metadata gutter (`HH:MM:SS  name  lvl │`) shown to the left of every
// log message. Continuation rows blank the metadata but keep the divider so
// wrapped text stays visually attached to its entry.
type DividerStyle = "normal" | "selected" | "copied";

// Transient highlight shown on the log rows right after their text is copied.
// `stage` steps from a brighter green to a dimmer one so the flash fades out.
export interface CopyFlash {
  readonly ids: ReadonlySet<number>;
  readonly stage: 0 | 1;
}

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
  return <span fg={colors.dim}>{LOG_DIVIDER}</span>;
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
        <span fg={colors.dim}>{blank}</span>
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

const HighlightedText = ({
  text,
  query,
  fallbackColor,
  selected,
  matchBg,
  currentMatchBg,
}: {
  readonly text: string;
  readonly query: string;
  readonly fallbackColor: string;
  readonly selected: boolean;
  // The fill behind a match. `currentMatchBg` applies on the cursor row (the
  // "current" hit a search lands on); `matchBg` to every other match.
  readonly matchBg: string;
  readonly currentMatchBg: string;
}) => {
  const needle = query.trim();
  if (!needle) return <span fg={fallbackColor}>{text}</span>;
  const lower = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const spans: ReactNode[] = [];
  let index = 0;
  let matchIndex = lower.indexOf(lowerNeedle);
  while (matchIndex >= 0) {
    if (matchIndex > index) {
      spans.push(
        <span key={`text-${index}`} fg={fallbackColor}>
          {text.slice(index, matchIndex)}
        </span>,
      );
    }
    spans.push(
      <span key={`hit-${matchIndex}`} fg={colors.screenBg} bg={selected ? currentMatchBg : matchBg}>
        {text.slice(matchIndex, matchIndex + needle.length)}
      </span>,
    );
    index = matchIndex + needle.length;
    matchIndex = lower.indexOf(lowerNeedle, index);
  }
  if (index < text.length) {
    spans.push(
      <span key={`text-${index}`} fg={fallbackColor}>
        {text.slice(index)}
      </span>,
    );
  }
  return <>{spans}</>;
};

export const LogRows = ({
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
  highlightQuery,
  searchActive,
  filterActive,
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
  readonly highlightQuery: string;
  readonly searchActive: boolean;
  readonly filterActive: boolean;
  readonly onScroll: (event: MouseEvent) => void;
}) => {
  // Filter matches read amber. Search hits read amber too when search stands
  // alone, but switch to the accent so they stay distinct from the amber filter
  // when a search runs inside a filter. The current hit (on the cursor row) is
  // always the accent — that's the match `n` / `N` move between.
  const matchBg = searchActive && filterActive ? colors.accent : colors.yellow;
  const currentMatchBg = searchActive ? colors.accent : colors.yellow;
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
        const color = highlighted ? colors.selectedText : logColor(log);
        const segments =
          log.ansiText && !highlightQuery.trim()
            ? (parseAnsiWrappedLines(log.ansiText, textWidth)[row.lineIndex] ?? [
                { text: row.text },
              ])
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
                {highlightQuery.trim()
                  ? segments.map((segment, segmentIndex) => (
                      <HighlightedText
                        key={segmentIndex}
                        text={segment.text}
                        query={highlightQuery}
                        fallbackColor={color}
                        selected={highlighted}
                        matchBg={matchBg}
                        currentMatchBg={currentMatchBg}
                      />
                    ))
                  : segments.map((segment, segmentIndex) => (
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
              <text fg={scrollbarChar === "#" ? colors.accent : colors.dim} wrapMode="none">
                {scrollbarChar}
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
};
