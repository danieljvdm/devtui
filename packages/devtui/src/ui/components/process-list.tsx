import { TextAttributes } from "@opentui/core";
import type { ProcessRuntime } from "../../core/domain.ts";
import { pad } from "../../core/text.ts";
import { colors, rgba } from "../../theme.ts";
import { leftPad, statusColor, statusDot } from "../process-status.ts";
import { Divider, hintSpans } from "./chrome.tsx";

export const ProcessList = ({
  processes,
  viewId,
  width,
  showHelp,
}: {
  readonly processes: readonly ProcessRuntime[];
  readonly viewId: string;
  readonly width: number;
  readonly showHelp: boolean;
}) => {
  const indexWidth = Math.max(1, String(processes.length).length);
  const textWidth = Math.max(1, width - 2);
  const naturalNameWidth = Math.max(
    "name".length,
    "merged".length,
    ...processes.map((process) => process.spec.name.length),
  );
  const nameWidth = Math.max(1, Math.min(naturalNameWidth, textWidth - indexWidth - 5));
  const mergedSelected = viewId === "merged";
  const runningCount = processes.filter((process) => process.status === "running").length;
  const mergedStatus =
    runningCount > 0
      ? "running"
      : processes.some((process) => process.status === "starting")
        ? "starting"
        : "stopped";

  return (
    <box flexDirection="column" width={width}>
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text wrapMode="none" truncate>
          <span fg={colors.dim}>
            {"  "}
            {leftPad("#", indexWidth)} ● {pad("name", nameWidth)}
          </span>
        </text>
      </box>
      <Divider width={width} solid />
      <box
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={mergedSelected ? rgba(colors.selectedBg) : undefined}
      >
        <text wrapMode="none" truncate>
          <span fg={mergedSelected ? colors.accent : colors.muted}>
            {mergedSelected ? "> " : "  "}
            {"Σ".padStart(indexWidth)}{" "}
          </span>
          <span fg={statusColor(mergedStatus)}>{statusDot(mergedStatus)} </span>
          <span
            fg={mergedSelected ? colors.selectedText : colors.text}
            attributes={TextAttributes.BOLD}
          >
            {pad("merged", nameWidth)}
          </span>
        </text>
      </box>
      {processes.map((process, index) => {
        const selected = viewId === process.id;
        return (
          <box
            key={process.id}
            height={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected ? rgba(colors.selectedBg) : undefined}
          >
            <text wrapMode="none" truncate>
              <span fg={selected ? colors.accent : colors.muted}>
                {selected ? "> " : "  "}
                {leftPad(String(index + 1), indexWidth)}{" "}
              </span>
              <span fg={statusColor(process.status)}>{statusDot(process.status)} </span>
              <span fg={selected ? colors.selectedText : colors.text}>
                {pad(process.spec.name, nameWidth)}
              </span>
            </text>
          </box>
        );
      })}
      {showHelp ? (
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text wrapMode="none" truncate>
            {hintSpans([
              ["h/l", "focus"],
              ["j/k", "select"],
              ["p", "picker"],
              ["/", "search"],
              ["f", "filter"],
              ["L", "level"],
              ["t", "theme"],
            ])}
          </text>
        </box>
      ) : null}
    </box>
  );
};
