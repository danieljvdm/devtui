import { RGBA } from "@opentui/core";

export const colors = {
  screenBg: "#101216",
  panelBg: "#151922",
  text: "#D7DCE2",
  muted: "#7F8A9A",
  dim: "#596273",
  accent: "#7DD3FC",
  green: "#74D680",
  yellow: "#F2C86B",
  red: "#F98080",
  violet: "#C4A7FF",
  selectedBg: "#263244",
  selectedText: "#FFFFFF",
  separator: "#2B3443",
  copyFlashBg: "#1C3A2A",
  copyFlashBgDim: "#172B22",
};

export const rgba = (hex: string) => RGBA.fromHex(hex);
