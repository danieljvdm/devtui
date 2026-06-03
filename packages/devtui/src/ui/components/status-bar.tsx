import { TextAttributes } from "@opentui/core";
import type { ProcessRuntime } from "../../core/domain.ts";
import { truncate } from "../../core/text.ts";
import { colors } from "../../theme.ts";
import type { ViewModel } from "../model.ts";
import type { LogLevelFilter } from "../state.ts";
import { statusLabel } from "../process-status.ts";
import { hintSpans, type Hint } from "./chrome.tsx";

const footerHintsFor = (view: ViewModel, crashed: boolean): readonly Hint[] =>
  crashed
    ? [
        ["r", "restart"],
        ["R", "restart all"],
        ["q", "quit"],
      ]
    : view.selectionCount > 0
      ? [
          ["y", "copy"],
          ["x", "mark"],
          ["esc", "clear"],
          ["q", "quit"],
        ]
      : [
          ["c", view.focusedPane === "processes" ? "copy URL" : "copy"],
          ["C", "clear"],
          ["/", "search"],
          ["f", "filter"],
          ["h/l", "focus"],
          ["?", "help"],
          ["q", "quit"],
        ];

export const StatusBar = ({
  width,
  view,
  activeProcess,
  crashed,
  logLevel,
  quitArmed,
  copyNotice,
}: {
  readonly width: number;
  readonly view: ViewModel;
  readonly activeProcess: ProcessRuntime | undefined;
  readonly crashed: boolean;
  readonly logLevel: LogLevelFilter;
  readonly quitArmed: boolean;
  readonly copyNotice: string | null;
}) => (
  <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
    <text wrapMode="none" truncate>
      <span fg={view.isFollowing ? colors.green : colors.dim}>
        {view.isFollowing ? "following" : "paused"}
      </span>
      {crashed && activeProcess ? (
        <>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={colors.red} attributes={TextAttributes.BOLD}>
            {statusLabel(activeProcess)}
          </span>
        </>
      ) : view.selectionCount > 0 ? (
        <>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={colors.accent} attributes={TextAttributes.BOLD}>
            {view.visualMode ? "visual " : ""}
            {view.selectionCount} selected
          </span>
        </>
      ) : (
        <>
          <span fg={colors.separator}>{"  "}</span>
          <span fg={colors.green}>L</span>
          <span fg={colors.dim}> level {logLevel}</span>
        </>
      )}
    </text>
    <box flexGrow={1} />
    <text wrapMode="none">
      {quitArmed ? (
        <span fg={colors.yellow} attributes={TextAttributes.BOLD}>
          press q again to quit
        </span>
      ) : copyNotice ? (
        <span fg={colors.green} attributes={TextAttributes.BOLD}>
          {truncate(copyNotice, Math.max(1, Math.floor(width * 0.32)))}
        </span>
      ) : (
        hintSpans(footerHintsFor(view, crashed))
      )}
    </text>
  </box>
);
