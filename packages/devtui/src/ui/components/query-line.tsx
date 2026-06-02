import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { truncate } from "../../core/text.ts";
import { colors, rgba } from "../../theme.ts";
import { QUERY_BAR_HEIGHT } from "../model.ts";

// The two narrowing tools sit on different axes, so they stack as two distinct
// bottom bars that can be on screen at the same time (search running inside an
// active filter). Filter = a stateful amber chip on a tinted band; search = a
// transient accent chip that blends with the terminal — mirroring the design.

// A solid block cursor: a space whose cell background is the foreground color.
const BlockCursor = () => <span bg={colors.text}> </span>;

// A single-row band, matching the design's height (its 4px padding is
// sub-character). The box background fills the full cell height, and with the
// rule moved above the bottom chrome the band sits flush on the status bar with
// no gap. The filter band is tinted; the search bar is transparent so it blends
// into the terminal, matching the design.
const QueryBar = ({
  band,
  width,
  children,
  hint,
}: {
  readonly band: boolean;
  readonly width: number;
  readonly children: ReactNode;
  readonly hint: string;
}) => (
  <box
    width={width}
    height={QUERY_BAR_HEIGHT}
    flexDirection="row"
    paddingLeft={1}
    paddingRight={1}
    backgroundColor={band ? rgba(colors.selectedBg) : undefined}
  >
    <box flexDirection="row">
      <text wrapMode="none">{children}</text>
    </box>
    <box flexGrow={1} />
    <text wrapMode="none" truncate>
      <span fg={colors.dim}>{hint}</span>
    </text>
  </box>
);

const FilterBar = ({
  editing,
  query,
  shown,
  total,
  hidden,
  width,
}: {
  readonly editing: boolean;
  readonly query: string;
  readonly shown: number;
  readonly total: number;
  readonly hidden: number;
  readonly width: number;
}) => {
  const shownQuery = truncate(query, Math.max(1, width - 48));
  if (editing) {
    return (
      <QueryBar band width={width} hint="type to narrow · enter keep · esc cancel">
        <span fg={colors.accent} attributes={TextAttributes.BOLD}>
          filter (f):{" "}
        </span>
        <span fg={colors.text}>{shownQuery}</span>
        <BlockCursor />
      </QueryBar>
    );
  }
  const count = `${shown} of ${total} lines${hidden > 0 ? ` · ${hidden} hidden` : ""}`;
  return (
    <QueryBar band width={width} hint="esc clear · f edit filter">
      <span fg={colors.dim}>filtered </span>
      <span fg={colors.screenBg} bg={colors.yellow} attributes={TextAttributes.BOLD}>
        {` ${shownQuery} `}
      </span>
      <span fg={colors.text}>{`  ${count}`}</span>
    </QueryBar>
  );
};

const SearchBar = ({
  editing,
  query,
  index,
  total,
  width,
}: {
  readonly editing: boolean;
  readonly query: string;
  readonly index: number;
  readonly total: number;
  readonly width: number;
}) => {
  const shownQuery = truncate(query, Math.max(1, width - 48));
  if (editing) {
    return (
      <QueryBar band={false} width={width} hint="enter jump to first hit · esc cancel">
        <span fg={colors.accent} attributes={TextAttributes.BOLD}>
          /{" "}
        </span>
        <span fg={colors.text}>{shownQuery}</span>
        <BlockCursor />
      </QueryBar>
    );
  }
  return (
    <QueryBar band={false} width={width} hint="n next · N prev · f filter to hits · esc done">
      <span fg={colors.dim}>search </span>
      <span fg={colors.screenBg} bg={colors.accent} attributes={TextAttributes.BOLD}>
        {` ${shownQuery} `}
      </span>
      <span fg={colors.text}>{`  match ${index} of ${total}`}</span>
    </QueryBar>
  );
};

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
  const showFilter = filterMode || filterText.length > 0;
  const showSearch = searchMode || searchText.length > 0;
  if (!showFilter && !showSearch) return null;
  const total = filteredCount + hiddenLogCount;
  return (
    <>
      {showFilter ? (
        <FilterBar
          editing={filterMode}
          query={filterText}
          shown={filteredCount}
          total={total}
          hidden={hiddenLogCount}
          width={width}
        />
      ) : null}
      {showSearch ? (
        <SearchBar
          editing={searchMode}
          query={searchText}
          index={selectedSearchMatchIndex ?? 0}
          total={searchMatchCount}
          width={width}
        />
      ) : null}
    </>
  );
};
