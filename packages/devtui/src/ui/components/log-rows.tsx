import { TextAttributes, type MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";
import type { LogEntry } from "../../core/domain.ts";
import { formatTime } from "../../core/text.ts";
import { colors, rgba } from "../../theme.ts";
import { parseAnsiWrappedLines } from "../ansi.ts";
import {
  logMetaWidth,
  LOG_DIVIDER,
  LOG_TIME_WIDTH,
  type LogDisplayRow,
  type ScrollbarModel,
} from "../model.ts";

// The dim metadata gutter (`HH:MM:SS ✗ │`) shown to the left of every log
// message: just the timestamp and a one-cell error marker (a red ✗ on error
// lines, blank otherwise) — severity is otherwise carried by the message color,
// and the process name lives in the sidebar (and the message's own prefix).
// Continuation rows blank the metadata but keep the divider so wrapped text
// stays visually attached to its entry.
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
  continuation,
  dividerStyle,
  highlighted,
}: {
  readonly log: LogEntry;
  readonly continuation: boolean;
  readonly dividerStyle: DividerStyle;
  // The cursor/selected row lifts its timestamp from dim to the bright text
  // color, matching the design's `.t-line.cur .gut .tm` rule.
  readonly highlighted: boolean;
}) => {
  if (continuation) {
    // Blank the timestamp (8) + marker pad (1) + marker cell (1), then keep the
    // divider so wrapped rows stay attached to their entry.
    const blank = " ".repeat(LOG_TIME_WIDTH + 1 + 1);
    return (
      <>
        <span fg={colors.dim}>{blank}</span>
        <DividerGlyph style={dividerStyle === "copied" ? "normal" : dividerStyle} />
      </>
    );
  }
  return (
    <>
      <span fg={highlighted ? colors.selectedText : colors.dim}>
        {formatTime(log.timestampMs)}{" "}
      </span>
      <span fg={colors.red} attributes={TextAttributes.BOLD}>
        {log.severity === "error" ? "✗" : " "}
      </span>
      <DividerGlyph style={dividerStyle} />
    </>
  );
};

const HighlightedText = ({
  text,
  query,
  fallbackColor,
  current,
  matchBg,
}: {
  readonly text: string;
  readonly query: string;
  readonly fallbackColor: string;
  // True only on the single search-cursor row, so the current-match treatment
  // never bleeds onto a multi-row copy/visual selection.
  readonly current: boolean;
  // The fill behind a non-current match (amber for a filter/standalone search,
  // accent when a search runs inside a filter).
  readonly matchBg: string;
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
    // The current search hit is inverse video of the cursor row (which is
    // already painted with selectedBg): selectedText fill, selectedBg glyphs.
    // That always contrasts — on dark-selection themes it reproduces the
    // design's bright --fg block; on light/inverted-selection themes (e.g. the
    // default) it stays a distinct dark block instead of vanishing into the row.
    spans.push(
      <span
        key={`hit-${matchIndex}`}
        fg={current ? colors.selectedBg : colors.screenBg}
        bg={current ? colors.selectedText : matchBg}
      >
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
  scrollbarActive,
  focused,
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
  // The thumb brightens to the accent only when scrolled back (follow paused);
  // while tailing it stays dim, matching the design's `.t-scroll-thumb.active`.
  readonly scrollbarActive: boolean;
  readonly focused: boolean;
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
  // when a search runs inside a filter. The current hit (the one `n` / `N` move
  // between) is the inverse-video block rendered in HighlightedText.
  const matchBg = searchActive && filterActive ? colors.accent : colors.yellow;
  const visibleRows = rows.slice(0, Math.max(0, height));
  const hasScrollbar = scrollbar !== null;
  const logPaneWidth = hasScrollbar ? Math.max(1, width - 1) : width;
  const scrollbarChars = Array.from({ length: Math.max(0, height) }, (_, index) => {
    if (!scrollbar) return "";
    return index >= scrollbar.thumbTop && index < scrollbar.thumbTop + scrollbar.thumbHeight
      ? "█"
      : "│";
  });

  return (
    <box flexDirection="column" width={width} height={height} onMouseScroll={onScroll}>
      {Array.from({ length: Math.max(0, height) }, (_, index) => {
        const row = visibleRows[index];
        const scrollbarChar = scrollbarChars[index] ?? "│";

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
        const textWidth = Math.max(1, logPaneWidth - logMetaWidth - 2);
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
                  continuation={continuation}
                  dividerStyle={dividerStyle}
                  highlighted={highlighted}
                />
                {highlightQuery.trim()
                  ? segments.map((segment, segmentIndex) => (
                      <HighlightedText
                        key={segmentIndex}
                        text={segment.text}
                        query={highlightQuery}
                        fallbackColor={color}
                        current={cursor && searchActive}
                        matchBg={matchBg}
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
              <text
                fg={
                  scrollbarChar === "█"
                    ? scrollbarActive
                      ? colors.accent
                      : colors.dim
                    : colors.separator
                }
                wrapMode="none"
              >
                {scrollbarChar}
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
};
