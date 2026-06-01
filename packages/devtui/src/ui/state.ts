import * as Atom from "effect/unstable/reactivity/Atom";
import type { LogSeverity } from "../core/domain.ts";

export type ViewId = "merged" | string;
export type LogLevelFilter = "all" | LogSeverity;
export type FocusedPane = "processes" | "logs";

export interface UiState {
  readonly viewId: ViewId;
  readonly focusedPane: FocusedPane;
  readonly filterMode: boolean;
  readonly filterText: string;
  readonly logLevel: LogLevelFilter;
  readonly processPickerOpen: boolean;
  readonly logAnchorId: number | null;
  readonly logAnchorLineIndex: number;
  readonly selectedLogId: number | null;
  readonly selectedLogLineIndex: number;
  readonly markedLogIds: readonly number[];
  readonly visualAnchorId: number | null;
  readonly visualAnchorLineIndex: number;
}

export const viewIdAtom = Atom.make<ViewId>("merged").pipe(Atom.keepAlive);
export const focusedPaneAtom = Atom.make<FocusedPane>("processes").pipe(Atom.keepAlive);
export const filterModeAtom = Atom.make(false).pipe(Atom.keepAlive);
export const filterTextAtom = Atom.make("").pipe(Atom.keepAlive);
export const logLevelAtom = Atom.make<LogLevelFilter>("all").pipe(Atom.keepAlive);
export const processPickerOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
export const logAnchorIdAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);
export const logAnchorLineIndexAtom = Atom.make(0).pipe(Atom.keepAlive);
export const selectedLogIdAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);
export const selectedLogLineIndexAtom = Atom.make(0).pipe(Atom.keepAlive);
export const markedLogIdsAtom = Atom.make<readonly number[]>([]).pipe(Atom.keepAlive);
export const visualAnchorIdAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);
export const visualAnchorLineIndexAtom = Atom.make(0).pipe(Atom.keepAlive);
