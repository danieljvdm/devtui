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

// Keybinding reference shown by the `?` overlay. Kept in sync with the reducer
// in ui/keyboard.ts so the help never advertises shortcuts that don't exist.
const HELP_KEYS: readonly (readonly [string, string])[] = [
  ["j / k", "move selection down / up"],
  ["h / l", "focus processes / logs"],
  ["1-9", "jump to process by number"],
  ["m", "merged view"],
  ["tab", "cycle process views"],
  ["/", "search logs"],
  ["f", "filter logs"],
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

export const HelpOverlay = ({
  width,
  height,
  processCount,
}: {
  readonly width: number;
  readonly height: number;
  readonly processCount: number;
}) => {
  const modalMaxWidth = Math.max(1, width - 4);
  const modalWidth = clamp(
    Math.floor(width * 0.84),
    Math.min(34, modalMaxWidth),
    Math.min(72, modalMaxWidth),
  );
  const modalMaxHeight = Math.max(1, height - 2);
  const modalHeight = clamp(HELP_KEYS.length + 5, Math.min(8, modalMaxHeight), modalMaxHeight);
  const innerHeight = Math.max(1, modalHeight - 4);
  const availableHelpRows = Math.max(0, innerHeight - 4);
  const helpRowsHidden = HELP_KEYS.length > availableHelpRows;
  const visibleHelpRows = HELP_KEYS.slice(
    0,
    helpRowsHidden ? Math.max(0, availableHelpRows - 1) : availableHelpRows,
  );
  const innerWidth = Math.max(1, modalWidth - 4);
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
        width={modalWidth}
        height={modalHeight}
        border
        borderStyle="rounded"
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
        {visibleHelpRows.map(([key, description]) => (
          <box key={key} height={1}>
            <text wrapMode="none" truncate>
              <span fg={colors.green} attributes={TextAttributes.BOLD}>
                {pad(key, keyColumn)}
              </span>
              <span fg={colors.muted}>
                {"   "}
                {truncate(description, Math.max(1, innerWidth - keyColumn - 3))}
              </span>
            </text>
          </box>
        ))}
        {helpRowsHidden ? (
          <box height={1}>
            <text wrapMode="none" truncate>
              <span fg={colors.dim}>more keys hidden in this terminal size</span>
            </text>
          </box>
        ) : null}
        <box height={1} />
        <box height={1}>
          <text wrapMode="none" truncate>
            <span fg={colors.dim}>
              {processCount} {processCount === 1 ? "process" : "processes"} · ? or esc to close
            </span>
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
