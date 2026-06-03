import { colors } from "../../theme.ts";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export type Hint = readonly [key: string, label: string];

// Renders `<key> label` pairs with the key highlighted and groups separated by
// breathing room, so the footer hints read as discrete shortcuts.
export const hintSpans = (hints: readonly Hint[]) =>
  hints.flatMap(([key, label], index) => [
    <span key={`gap-${index}`} fg={colors.separator}>
      {index === 0 ? "" : "  "}
    </span>,
    <span key={`key-${index}`} fg={colors.green}>
      {key}
    </span>,
    <span key={`label-${index}`} fg={colors.muted}>
      {" "}
      {label}
    </span>,
  ]);

export const modalHintSpans = (hints: readonly Hint[]) =>
  hints.flatMap(([key, label], index) => [
    <span key={`gap-${index}`} fg={colors.separator}>
      {index === 0 ? "" : "  "}
    </span>,
    <span key={`key-${index}`} fg={colors.green}>
      {key}
    </span>,
    <span key={`label-${index}`} fg={colors.muted}>
      {` ${label}`}
    </span>,
  ]);

export const Divider = ({
  width,
  solid = false,
}: {
  readonly width: number;
  readonly solid?: boolean;
}) => (
  <box height={1}>
    <text fg={colors.dim} wrapMode="none" truncate>
      {(solid ? "─" : "╌").repeat(Math.max(1, width))}
    </text>
  </box>
);

export const SeparatorColumn = ({ height }: { readonly height: number }) => (
  <box width={1} height={height}>
    {Array.from({ length: Math.max(0, height) }, (_, index) => (
      <text key={index} fg={colors.dim} wrapMode="none">
        │
      </text>
    ))}
  </box>
);
