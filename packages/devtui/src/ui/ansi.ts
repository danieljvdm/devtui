import { TextAttributes, ansi256IndexToRgb } from "@opentui/core";

export interface AnsiSegment {
  readonly text: string;
  readonly fg?: string;
  readonly attributes?: number;
}

interface AnsiState {
  readonly fg?: string;
  readonly attributes: number;
}

const sgrPattern = /\x1b\[([0-?]*)([ -/]*)([@-~])/g;

const ansi16: Readonly<Record<number, string>> = {
  30: "#000000",
  31: "#CD3131",
  32: "#0DBC79",
  33: "#E5E510",
  34: "#2472C8",
  35: "#BC3FBC",
  36: "#11A8CD",
  37: "#E5E5E5",
  90: "#666666",
  91: "#F14C4C",
  92: "#23D18B",
  93: "#F5F543",
  94: "#3B8EEA",
  95: "#D670D6",
  96: "#29B8DB",
  97: "#FFFFFF",
};

const toHex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();

const ansi256 = (index: number) => {
  const [red, green, blue] = ansi256IndexToRgb(index);
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

const pushText = (segments: AnsiSegment[], state: AnsiState, text: string) => {
  if (!text) return;
  const segment = {
    text,
    ...(state.fg === undefined ? {} : { fg: state.fg }),
    ...(state.attributes === TextAttributes.NONE ? {} : { attributes: state.attributes }),
  };
  const previous = segments[segments.length - 1];
  if (previous && previous.fg === segment.fg && previous.attributes === segment.attributes) {
    segments[segments.length - 1] = { ...previous, text: previous.text + text };
    return;
  }
  segments.push(segment);
};

const applySgr = (state: AnsiState, rawCodes: string) => {
  const codes =
    rawCodes.length === 0 ? [0] : rawCodes.split(";").map((code) => Number(code || "0"));
  let next = state;

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] ?? 0;
    switch (code) {
      case 0:
        next = { attributes: TextAttributes.NONE };
        break;
      case 1:
        next = { ...next, attributes: next.attributes | TextAttributes.BOLD };
        break;
      case 2:
        next = { ...next, attributes: next.attributes | TextAttributes.DIM };
        break;
      case 3:
        next = { ...next, attributes: next.attributes | TextAttributes.ITALIC };
        break;
      case 4:
        next = { ...next, attributes: next.attributes | TextAttributes.UNDERLINE };
        break;
      case 22:
        next = {
          ...next,
          attributes: next.attributes & ~TextAttributes.BOLD & ~TextAttributes.DIM,
        };
        break;
      case 23:
        next = { ...next, attributes: next.attributes & ~TextAttributes.ITALIC };
        break;
      case 24:
        next = { ...next, attributes: next.attributes & ~TextAttributes.UNDERLINE };
        break;
      case 39:
        next = { ...next, fg: undefined };
        break;
      case 38: {
        const mode = codes[index + 1];
        if (mode === 5 && typeof codes[index + 2] === "number") {
          next = { ...next, fg: ansi256(codes[index + 2]!) };
          index += 2;
        } else if (
          mode === 2 &&
          typeof codes[index + 2] === "number" &&
          typeof codes[index + 3] === "number" &&
          typeof codes[index + 4] === "number"
        ) {
          next = {
            ...next,
            fg: `#${toHex(codes[index + 2]!)}${toHex(codes[index + 3]!)}${toHex(codes[index + 4]!)}`,
          };
          index += 4;
        }
        break;
      }
      default:
        if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          next = { ...next, fg: ansi16[code] };
        }
        break;
    }
  }

  return next;
};

const parseAnsiSegmentsFull = (input: string): readonly AnsiSegment[] => {
  const segments: AnsiSegment[] = [];
  let state: AnsiState = { attributes: TextAttributes.NONE };
  let cursor = 0;

  for (const match of input.matchAll(sgrPattern)) {
    const start = match.index ?? 0;
    pushText(segments, state, input.slice(cursor, start));

    if (match[3] === "m" && match[2] === "") {
      state = applySgr(state, match[1] ?? "");
    }
    cursor = start + match[0].length;
  }

  pushText(segments, state, input.slice(cursor));
  return segments;
};

export const parseAnsiSegments = (input: string, maxWidth: number): readonly AnsiSegment[] => {
  if (maxWidth <= 0) return [];
  const segments: AnsiSegment[] = [];
  let remaining = maxWidth;

  for (const segment of parseAnsiSegmentsFull(input)) {
    if (remaining <= 0) return segments;
    const text = segment.text.slice(0, remaining);
    if (text) segments.push({ ...segment, text });
    remaining -= text.length;
  }

  return segments;
};

export const parseAnsiWrappedLines = (
  input: string,
  width: number,
): readonly (readonly AnsiSegment[])[] => {
  if (width <= 0) return [[]];

  const lines: AnsiSegment[][] = [[]];
  let remaining = width;

  const pushSegment = (segment: AnsiSegment) => {
    if (!segment.text) return;
    const line = lines[lines.length - 1]!;
    const previous = line[line.length - 1];
    if (previous && previous.fg === segment.fg && previous.attributes === segment.attributes) {
      line[line.length - 1] = { ...previous, text: previous.text + segment.text };
      return;
    }
    line.push(segment);
  };

  for (const segment of parseAnsiSegmentsFull(input)) {
    let text = segment.text;
    while (text.length > 0) {
      if (remaining === 0) {
        lines.push([]);
        remaining = width;
      }

      const chunk = text.slice(0, remaining);
      pushSegment({ ...segment, text: chunk });
      text = text.slice(chunk.length);
      remaining -= chunk.length;
    }
  }

  return lines;
};
