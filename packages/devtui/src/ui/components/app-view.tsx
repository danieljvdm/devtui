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
  nameColWidth,
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
  readonly nameColWidth: number;
  readonly copyFlash: CopyFlash | null;
  readonly copyNotice: string | null;
  readonly quitArmed: boolean;
  readonly activeProcess: ProcessRuntime | undefined;
  readonly crashed: boolean;
  readonly onLogScroll: (event: MouseEvent) => void;
}) => {
  const logPaneWidth = Math.max(1, width - layout.processRailWidth - 1);
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
                focused={view.focusedPane === "logs"}
                nameWidth={nameColWidth}
                selectedLogId={uiState.selectedLogId}
                selectedLogLineIndex={uiState.selectedLogLineIndex}
                selectedLogIds={view.selectedLogIds}
                copyFlash={copyFlash}
                highlightQuery={highlightQuery}
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
              <Divider width={width} />
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
              focused={view.focusedPane === "logs"}
              nameWidth={nameColWidth}
              selectedLogId={uiState.selectedLogId}
              selectedLogLineIndex={uiState.selectedLogLineIndex}
              selectedLogIds={view.selectedLogIds}
              copyFlash={copyFlash}
              highlightQuery={highlightQuery}
              onScroll={onLogScroll}
            />
          )}
        </>
      )}
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
      <Divider width={width} solid />
      <StatusBar
        width={width}
        view={view}
        themeName={uiState.themeName}
        activeProcess={activeProcess}
        crashed={crashed}
        logLevel={uiState.logLevel}
        quitArmed={quitArmed}
        copyNotice={copyNotice}
      />
      {uiState.helpOpen ? (
        <HelpOverlay width={width} height={height} processCount={snapshot.processes.length} />
      ) : null}
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
