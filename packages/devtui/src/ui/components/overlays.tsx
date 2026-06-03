import { RGBA, TextAttributes } from "@opentui/core";
import type { ProcessRuntime } from "../../core/domain.ts";
import { pad, truncate } from "../../core/text.ts";
import { colors, rgba, themeNamesMatching, type ThemeName } from "../../theme.ts";
import { clamp, Divider, hintSpans, modalHintSpans } from "./chrome.tsx";

export const themePickerListHeightFor = (height: number, query: string) =>
  Math.max(
    1,
    clamp(
      9 + Math.min(themeNamesMatching(query).length, 8),
      Math.min(9, Math.max(1, height - 2)),
      Math.min(20, Math.max(1, height - 2)),
    ) - 6,
  );

export const ProcessPicker = ({
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

// Keybinding reference shown by the `?` overlay, organized into the design's
// three groups. Kept in sync with the reducer in ui/keyboard.ts so the help
// never advertises shortcuts that don't exist (e.g. there is no `F` follow key
// — following resumes automatically when you scroll back to the tail).
interface HelpGroup {
  readonly label: string;
  readonly keys: readonly (readonly [key: string, description: string])[];
}
const HELP_GROUPS: readonly HelpGroup[] = [
  {
    label: "navigate",
    keys: [
      ["j / k", "move selection down / up"],
      ["h / l", "focus processes / logs"],
      ["1-9", "jump to process by number"],
      ["m", "merged view"],
      ["tab", "cycle process views"],
    ],
  },
  {
    label: "logs",
    keys: [
      ["/", "search — find & jump (n / N)"],
      ["f", "filter — show only matches"],
      ["L", "cycle log level"],
      ["c / y", "copy selection"],
      ["C", "clear log buffer"],
    ],
  },
  {
    label: "control",
    keys: [
      ["x", "mark row · stop process"],
      ["V", "visual select range"],
      ["r / R", "restart process / restart all"],
      ["t", "choose theme"],
      ["? / q", "toggle help / quit devtui"],
    ],
  },
];
const HELP_SUB = "/ search · n/N jump hits · f filter · in search, f filters to hits";

// The grouped key list flattened to render rows: a dim group label, its key
// rows, and a blank row between groups. Lets the small-terminal truncation work
// on a single list while preserving the visual grouping.
type HelpLine =
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "key"; readonly key: string; readonly description: string }
  | { readonly kind: "blank" };

const helpLines: readonly HelpLine[] = HELP_GROUPS.flatMap((group, index) => [
  ...(index > 0 ? [{ kind: "blank" } as const] : []),
  { kind: "label", text: group.label } as const,
  ...group.keys.map(([key, description]) => ({ kind: "key", key, description }) as const),
]);
const helpKeyColumn = HELP_GROUPS.reduce(
  (max, group) => group.keys.reduce((m, [key]) => Math.max(m, key.length), max),
  0,
);

export const HelpOverlay = ({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) => {
  const modalMaxWidth = Math.max(1, width - 4);
  const modalWidth = clamp(
    Math.floor(width * 0.84),
    Math.min(40, modalMaxWidth),
    Math.min(72, modalMaxWidth),
  );
  const modalMaxHeight = Math.max(1, height - 2);
  // title + blank + content + blank + sub, inside border (2) + vertical padding (2).
  const chromeRows = 4 + 4;
  const modalHeight = clamp(
    helpLines.length + chromeRows,
    Math.min(10, modalMaxHeight),
    modalMaxHeight,
  );
  const innerHeight = Math.max(1, modalHeight - 4);
  const availableContentRows = Math.max(0, innerHeight - 4);
  const linesHidden = helpLines.length > availableContentRows;
  const slicedLines = linesHidden
    ? helpLines.slice(0, Math.max(0, availableContentRows - 1))
    : helpLines;
  // When truncating, drop any trailing group label or blank so a shown group is
  // never headerless and no orphan blank sits above the footer. `linesHidden`
  // stays computed from the full length, so "more keys hidden" still shows.
  let visibleCount = slicedLines.length;
  while (visibleCount > 0 && slicedLines[visibleCount - 1]?.kind !== "key") visibleCount -= 1;
  const visibleLines = slicedLines.slice(0, visibleCount);
  const innerWidth = Math.max(1, modalWidth - 4);
  const descriptionWidth = Math.max(1, innerWidth - helpKeyColumn - 2);
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
        width={modalWidth}
        height={modalHeight}
        border
        borderStyle="single"
        borderColor={colors.dim}
        backgroundColor={rgba(colors.panelBg)}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <box height={1}>
          <text wrapMode="none" truncate>
            <span fg={colors.accent} attributes={TextAttributes.BOLD}>
              devtui · keys
            </span>
          </text>
        </box>
        <box height={1} />
        {visibleLines.map((line, index) => {
          if (line.kind === "blank") return <box key={`blank-${index}`} height={1} />;
          if (line.kind === "label")
            return (
              <box key={`label-${line.text}`} height={1}>
                <text wrapMode="none" truncate>
                  <span fg={colors.dim}>{line.text}</span>
                </text>
              </box>
            );
          return (
            <box key={`key-${line.key}`} height={1}>
              <text wrapMode="none" truncate>
                <span fg={colors.green}>{line.key.padStart(helpKeyColumn)}</span>
                <span fg={colors.dim}>
                  {"  "}
                  {truncate(line.description, descriptionWidth)}
                </span>
              </text>
            </box>
          );
        })}
        {linesHidden ? (
          <box height={1}>
            <text wrapMode="none" truncate>
              <span fg={colors.dim}>more keys hidden in this terminal size</span>
            </text>
          </box>
        ) : null}
        <box height={1} />
        <box height={1}>
          <text wrapMode="none" truncate>
            <span fg={colors.dim}>{truncate(HELP_SUB, innerWidth)}</span>
          </text>
        </box>
      </box>
    </box>
  );
};

export const ThemeSelectorOverlay = ({
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
