import type { MouseEvent } from "@opentui/core";
import type { ProcessRuntime, RunnerSnapshot } from "../../core/domain.ts";
import { colors, rgba } from "../../theme.ts";
import type { LayoutModel, ViewModel } from "../model.ts";
import type { UiState } from "../state.ts";
import { Divider, SeparatorColumn } from "./chrome.tsx";
import type { CopyFlash } from "./log-rows.tsx";
import { LogRows } from "./log-rows.tsx";
import { HelpOverlay, ProcessPicker, ThemeSelectorOverlay } from "./overlays.tsx";
import { ProcessList } from "./process-list.tsx";
import { QueryLine } from "./query-line.tsx";
import { StatusBar } from "./status-bar.tsx";

export const AppView = ({
  width,
  height,
  snapshot,
  layout,
  view,
  uiState,
  copyFlash,
  copyNotice,
  quitArmed,
  activeProcess,
  crashed,
  onLogScroll,
}: {
  readonly width: number;
  readonly height: number;
  readonly snapshot: RunnerSnapshot;
  readonly layout: LayoutModel;
  readonly view: ViewModel;
  readonly uiState: UiState;
  readonly copyFlash: CopyFlash | null;
  readonly copyNotice: string | null;
  readonly quitArmed: boolean;
  readonly activeProcess: ProcessRuntime | undefined;
  readonly crashed: boolean;
  readonly onLogScroll: (event: MouseEvent) => void;
}) => {
  const logPaneWidth = Math.max(1, width - layout.processRailWidth - 1);
  const searchActive = uiState.searchText.trim().length > 0;
  const filterActive = uiState.filterText.trim().length > 0;
  // Whether a filter/search band is on screen (matches QueryLine's own visibility
  // and the view model's query-height reservation).
  const queryActive =
    uiState.filterMode ||
    uiState.filterText.length > 0 ||
    uiState.searchMode ||
    uiState.searchText.length > 0;
  // Search highlighting takes the stage when active (it tracks a moving cursor);
  // otherwise the filter term is highlighted in place.
  const highlightQuery = uiState.searchText || uiState.filterText;

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      backgroundColor={rgba(colors.screenBg)}
    >
      {layout.showAnySideRail ? (
        <box flexDirection="row" height={view.logPaneHeight}>
          <ProcessList
            processes={snapshot.processes}
            viewId={uiState.viewId}
            width={layout.processRailWidth}
            showHelp={false}
          />
          <SeparatorColumn height={view.logPaneHeight} />
          <box flexDirection="column" width={logPaneWidth}>
            {uiState.processPickerOpen ? (
              <ProcessPicker
                processes={snapshot.processes}
                viewId={uiState.viewId}
                width={logPaneWidth}
                height={view.logPaneHeight}
              />
            ) : (
              <LogRows
                rows={view.logRows}
                width={logPaneWidth}
                height={view.logPaneHeight}
                scrollbar={view.scrollbar}
                scrollbarActive={!view.isFollowing}
                focused={view.focusedPane === "logs"}
                selectedLogId={uiState.selectedLogId}
                selectedLogLineIndex={uiState.selectedLogLineIndex}
                selectedLogIds={view.selectedLogIds}
                copyFlash={copyFlash}
                highlightQuery={highlightQuery}
                searchActive={searchActive}
                filterActive={filterActive}
                onScroll={onLogScroll}
              />
            )}
          </box>
        </box>
      ) : (
        <>
          {layout.showTopProcesses ? (
            <>
              <ProcessList
                processes={snapshot.processes}
                viewId={uiState.viewId}
                width={width}
                showHelp
              />
              <Divider width={width} solid />
            </>
          ) : null}
          {uiState.processPickerOpen ? (
            <ProcessPicker
              processes={snapshot.processes}
              viewId={uiState.viewId}
              width={width}
              height={view.logPaneHeight}
            />
          ) : (
            <LogRows
              rows={view.logRows}
              width={width}
              height={view.logPaneHeight}
              scrollbar={view.scrollbar}
              scrollbarActive={!view.isFollowing}
              focused={view.focusedPane === "logs"}
              selectedLogId={uiState.selectedLogId}
              selectedLogLineIndex={uiState.selectedLogLineIndex}
              selectedLogIds={view.selectedLogIds}
              copyFlash={copyFlash}
              highlightQuery={highlightQuery}
              searchActive={searchActive}
              filterActive={filterActive}
              onScroll={onLogScroll}
            />
          )}
        </>
      )}
      {/* With no query, a rule separates the logs from the status bar. With a
          query active the filter/search bands take that slot: each is a tinted
          block that abuts the logs above and the status bar below, flush, with
          its text centered — matching the design (no heavy divider between). */}
      {queryActive ? null : <Divider width={width} solid />}
      <QueryLine
        filterMode={uiState.filterMode}
        filterText={uiState.filterText}
        searchMode={uiState.searchMode}
        searchText={uiState.searchText}
        filteredCount={view.filteredCount}
        hiddenLogCount={view.hiddenLogCount}
        searchMatchCount={view.searchMatchCount}
        selectedSearchMatchIndex={view.selectedSearchMatchIndex}
        width={width}
      />
      <StatusBar
        width={width}
        view={view}
        activeProcess={activeProcess}
        crashed={crashed}
        logLevel={uiState.logLevel}
        quitArmed={quitArmed}
        copyNotice={copyNotice}
      />
      {uiState.helpOpen ? <HelpOverlay width={width} height={height} /> : null}
      {uiState.themePickerOpen ? (
        <ThemeSelectorOverlay
          width={width}
          height={height}
          themeName={uiState.themeName}
          query={uiState.themeFilterText}
          scrollIndex={uiState.themeScrollIndex}
        />
      ) : null}
    </box>
  );
};
