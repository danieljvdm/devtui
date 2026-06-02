import { TextAttributes } from "@opentui/core";
import { truncate } from "../../core/text.ts";
import { colors, rgba } from "../../theme.ts";

export const QueryLine = ({
  filterMode,
  filterText,
  searchMode,
  searchText,
  filteredCount,
  hiddenLogCount,
  searchMatchCount,
  selectedSearchMatchIndex,
  width,
}: {
  readonly filterMode: boolean;
  readonly filterText: string;
  readonly searchMode: boolean;
  readonly searchText: string;
  readonly filteredCount: number;
  readonly hiddenLogCount: number;
  readonly searchMatchCount: number;
  readonly selectedSearchMatchIndex: number | null;
  readonly width: number;
}) => {
  const editing = filterMode || searchMode;
  const mode = filterMode ? "filter" : "search";
  const query = filterMode ? filterText : searchMode ? searchText : filterText || searchText;
  if (!editing && !query) return null;

  const activeFilter = filterText.length > 0;
  const label = editing
    ? mode === "filter"
      ? "filter (f):"
      : "search /"
    : activeFilter
      ? "filtered"
      : "search";
  const hint = editing
    ? mode === "filter"
      ? "type to narrow · enter keep · esc cancel"
      : "type to highlight · enter keep · esc cancel"
    : activeFilter
      ? "esc clear · f edit filter"
      : "esc clear · f filter to hits";
  const metric = editing
    ? ""
    : activeFilter
      ? `${filteredCount} shown · ${hiddenLogCount} hidden`
      : `match ${selectedSearchMatchIndex ?? 0} of ${searchMatchCount}`;
  const fixedWidth = label.length + hint.length + metric.length + 10;
  const shownQuery = truncate(query, Math.max(1, width - fixedWidth));
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
          <span
            fg={mode === "filter" || activeFilter ? colors.accent : colors.green}
            attributes={TextAttributes.BOLD}
          >
            {label}{" "}
          </span>
          {shownQuery ? (
            <span fg={colors.yellow} attributes={TextAttributes.INVERSE}>
              {shownQuery}
            </span>
          ) : null}
          {editing ? (
            <span fg={colors.text} attributes={TextAttributes.INVERSE}>
              {" "}
            </span>
          ) : null}
          {metric ? (
            <span fg={colors.muted}>
              {"  "}
              {metric}
            </span>
          ) : null}
        </text>
      </box>
      <box flexGrow={1} />
      <text wrapMode="none" truncate>
        <span fg={colors.dim}>{hint}</span>
      </text>
    </box>
  );
};
