import { CliRenderEvents, type MouseEvent } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardRuntime } from "./core/clipboard.ts";
import type { DevtuiConfig, RunnerSnapshot } from "./core/domain.ts";
import type { ProcessRunner } from "./core/runner.ts";
import { setActiveTheme, type ThemeName } from "./theme.ts";
import { AppView } from "./ui/components/app-view.tsx";
import type { CopyFlash } from "./ui/components/log-rows.tsx";
import { themePickerListHeightFor } from "./ui/components/overlays.tsx";
import { keepTerminalCursorHidden } from "./ui/cursor.ts";
import {
  keyboardKeysFromInputSequence,
  reduceKeyboard,
  reduceLogScroll,
  resolveQuitConfirmation,
  type KeyboardKey,
  type UiCommand,
} from "./ui/keyboard.ts";
import { buildLayoutModel, buildViewModel } from "./ui/model.ts";
import { isCrashed } from "./ui/process-status.ts";
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
  searchModeAtom,
  searchTextAtom,
  selectedLogIdAtom,
  selectedLogLineIndexAtom,
  themeFilterTextAtom,
  themeNameAtom,
  themePickerOpenAtom,
  themeScrollIndexAtom,
  visualAnchorIdAtom,
  visualAnchorLineIndexAtom,
  type UiState,
  viewIdAtom,
} from "./ui/state.ts";

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
    case "notify":
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
  const hideNativeCursor = () => keepTerminalCursorHidden(renderer, process.stdout);
  const snapshotAtom = useMemo(() => Atom.subscriptionRef(runner.snapshotRef), [runner]);
  const snapshot = useAtomValue(snapshotAtom) as RunnerSnapshot;
  const [viewId, setViewId] = useAtom(viewIdAtom);
  const [focusedPane, setFocusedPane] = useAtom(focusedPaneAtom);
  const [filterMode, setFilterMode] = useAtom(filterModeAtom);
  const [filterText, setFilterText] = useAtom(filterTextAtom);
  const [searchMode, setSearchMode] = useAtom(searchModeAtom);
  const [searchText, setSearchText] = useAtom(searchTextAtom);
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

  useEffect(() => {
    hideNativeCursor();
  });

  useEffect(() => {
    const hideOnFocus = () => hideNativeCursor();
    renderer.on(CliRenderEvents.FOCUS, hideOnFocus);
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, hideOnFocus);
    renderer.on(CliRenderEvents.FOCUSED_EDITOR, hideOnFocus);
    return () => {
      renderer.off(CliRenderEvents.FOCUS, hideOnFocus);
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, hideOnFocus);
      renderer.off(CliRenderEvents.FOCUSED_EDITOR, hideOnFocus);
    };
  }, [renderer]);

  setActiveTheme(themeName);

  const [copyFlash, setCopyFlash] = useState<CopyFlash | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const copyFlashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCopiedRows = (logIds: readonly number[]) => {
    const ids = new Set(logIds);
    copyFlashTimers.current.forEach(clearTimeout);
    copyFlashTimers.current = [
      setTimeout(() => setCopyFlash({ ids, stage: 1 }), 550),
      setTimeout(() => setCopyFlash(null), 950),
    ];
    setCopyFlash({ ids, stage: 0 });
  };
  const showNotice = (message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setCopyNotice(message);
    noticeTimer.current = setTimeout(() => setCopyNotice(null), 1600);
  };

  useEffect(
    () => () => {
      copyFlashTimers.current.forEach(clearTimeout);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Quitting is guarded by a confirm step: the first quit press arms a window,
  // a second one within it actually quits, and any other key (or the timeout)
  // disarms. The ref mirrors the state so the captured input handler sees the
  // latest value without being re-registered.
  const [quitArmed, setQuitArmed] = useState(false);
  const quitArmedRef = useRef(false);
  const quitArmedAtRef = useRef(0);
  const quitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setQuitArm = (armed: boolean) => {
    quitArmedRef.current = armed;
    quitArmedAtRef.current = armed ? Date.now() : 0;
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

  const layout = buildLayoutModel(width, height, snapshot.processes);
  const uiState: UiState = {
    viewId,
    focusedPane,
    filterMode,
    filterText,
    searchMode,
    searchText,
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
  const themePickerListHeight = themePickerListHeightFor(height, themeFilterText);
  const view = buildViewModel({
    snapshot,
    viewId,
    filterText,
    searchText,
    logLevel,
    filterMode,
    searchMode,
    showProcessList: layout.showTopProcesses,
    sideRail: layout.showAnySideRail,
    logAnchorId,
    logAnchorLineIndex,
    selectedLogId,
    selectedLogLineIndex,
    focusedPane,
    height,
    logWidth: layout.logPaneWidth,
    markedLogIds,
    visualAnchorId,
    visualAnchorLineIndex,
  });
  const stateRef = useRef({ state: uiState, snapshot, view, themePickerListHeight });
  stateRef.current = { state: uiState, snapshot, view, themePickerListHeight };

  const applyUiState = (nextState: UiState) => {
    setViewId(nextState.viewId);
    setFocusedPane(nextState.focusedPane);
    setFilterMode(nextState.filterMode);
    setFilterText(nextState.filterText);
    setSearchMode(nextState.searchMode);
    setSearchText(nextState.searchText);
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
      const armedAgeMs = quitArmedRef.current ? Date.now() - quitArmedAtRef.current : 0;
      if (resolveQuitConfirmation(key, quitArmedRef.current, armedAgeMs) === "execute") {
        setQuitArm(false);
        runCommand(runner, clipboard, result.command);
        renderer.destroy();
        return;
      }
      setQuitArm(true);
      return;
    }

    if (quitArmedRef.current) setQuitArm(false);

    if (result.command._tag === "copyText") {
      if (result.command.logIds.length > 0) flashCopiedRows(result.command.logIds);
      if (result.command.label) showNotice(result.command.label);
    }
    if (result.command._tag === "notify") showNotice(result.command.message);

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
      const keys = keyboardKeysFromInputSequence(sequence);
      if (keys.length === 0) return false;
      keys.forEach(applyKeyboard);
      return true;
    };

    renderer.prependInputHandler(handleInput);
    return () => renderer.removeInputHandler(handleInput);
  }, [renderer, runner, clipboard]);

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

  return (
    <AppView
      width={width}
      height={height}
      snapshot={snapshot}
      layout={layout}
      view={view}
      uiState={uiState}
      copyFlash={copyFlash}
      copyNotice={copyNotice}
      quitArmed={quitArmed}
      activeProcess={activeProcess}
      crashed={crashed}
      onLogScroll={onLogScroll}
    />
  );
};
