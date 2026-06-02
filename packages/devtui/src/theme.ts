import { RGBA } from "@opentui/core";

export interface ThemeColors {
  readonly screenBg: string;
  readonly panelBg: string;
  readonly text: string;
  readonly muted: string;
  readonly dim: string;
  readonly accent: string;
  readonly green: string;
  readonly yellow: string;
  readonly red: string;
  readonly violet: string;
  readonly selectedBg: string;
  readonly selectedText: string;
  readonly separator: string;
  readonly copyFlashBg: string;
  readonly copyFlashBgDim: string;
}

export const themeNames = [
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dracula",
  "everforest-dark",
  "gruvbox-dark",
  "kanagawa-wave",
  "nord",
  "one-half-dark",
  "rosepine",
  "solarized",
  "synthwave84",
  "system",
  "tokyonight",
  "vercel",
  "vesper",
  "zenburn",
] as const;

export type ThemeName = (typeof themeNames)[number];

const systemTheme: ThemeColors = {
  screenBg: "#282C34",
  panelBg: "#1D1F21",
  text: "#FFFFFF",
  muted: "#C4C8C6",
  dim: "#666666",
  accent: "#82A2BE",
  green: "#B6BD68",
  yellow: "#F0C674",
  red: "#CC6566",
  violet: "#B294BB",
  selectedBg: "#FFFFFF",
  selectedText: "#282C34",
  separator: "#1D1F21",
  copyFlashBg: "#2F3A2E",
  copyFlashBgDim: "#2A322A",
};

// Palettes are mapped from Ghostty themes in:
// https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/ghostty
export const themes: Record<ThemeName, ThemeColors> = {
  "catppuccin-macchiato": {
    screenBg: "#24273A",
    panelBg: "#494D64",
    text: "#CAD3F5",
    muted: "#A5ADCB",
    dim: "#5B6078",
    accent: "#8AADF4",
    green: "#A6DA95",
    yellow: "#EED49F",
    red: "#ED8796",
    violet: "#F5BDE6",
    selectedBg: "#5B6078",
    selectedText: "#CAD3F5",
    separator: "#494D64",
    copyFlashBg: "#344A3F",
    copyFlashBgDim: "#2D3D37",
  },
  "catppuccin-mocha": {
    screenBg: "#1E1E2E",
    panelBg: "#45475A",
    text: "#CDD6F4",
    muted: "#A6ADC8",
    dim: "#585B70",
    accent: "#89B4FA",
    green: "#A6E3A1",
    yellow: "#F9E2AF",
    red: "#F38BA8",
    violet: "#F5C2E7",
    selectedBg: "#585B70",
    selectedText: "#CDD6F4",
    separator: "#45475A",
    copyFlashBg: "#344D43",
    copyFlashBgDim: "#2D3F39",
  },
  dracula: {
    screenBg: "#282A36",
    panelBg: "#21222C",
    text: "#F8F8F2",
    muted: "#F8F8F2",
    dim: "#6272A4",
    accent: "#BD93F9",
    green: "#50FA7B",
    yellow: "#F1FA8C",
    red: "#FF5555",
    violet: "#FF79C6",
    selectedBg: "#44475A",
    selectedText: "#FFFFFF",
    separator: "#21222C",
    copyFlashBg: "#2D4A34",
    copyFlashBgDim: "#2A3B31",
  },
  "everforest-dark": {
    screenBg: "#1E2326",
    panelBg: "#7A8478",
    text: "#D3C6AA",
    muted: "#F2EFDF",
    dim: "#A6B0A0",
    accent: "#7FBBB3",
    green: "#A7C080",
    yellow: "#DBBC7F",
    red: "#E67E80",
    violet: "#D699B6",
    selectedBg: "#4C3743",
    selectedText: "#D3C6AA",
    separator: "#7A8478",
    copyFlashBg: "#33412E",
    copyFlashBgDim: "#2B342B",
  },
  "gruvbox-dark": {
    screenBg: "#282828",
    panelBg: "#282828",
    text: "#EBDBB2",
    muted: "#A89984",
    dim: "#928374",
    accent: "#458588",
    green: "#98971A",
    yellow: "#D79921",
    red: "#CC241D",
    violet: "#B16286",
    selectedBg: "#665C54",
    selectedText: "#EBDBB2",
    separator: "#282828",
    copyFlashBg: "#34371E",
    copyFlashBgDim: "#2F311F",
  },
  "kanagawa-wave": {
    screenBg: "#1F1F28",
    panelBg: "#090618",
    text: "#DCD7BA",
    muted: "#C8C093",
    dim: "#727169",
    accent: "#7E9CD8",
    green: "#76946A",
    yellow: "#C0A36E",
    red: "#C34043",
    violet: "#957FB8",
    selectedBg: "#DCD7BA",
    selectedText: "#1F1F28",
    separator: "#090618",
    copyFlashBg: "#2A362C",
    copyFlashBgDim: "#252D28",
  },
  nord: {
    screenBg: "#2E3440",
    panelBg: "#3B4252",
    text: "#D8DEE9",
    muted: "#E5E9F0",
    dim: "#596377",
    accent: "#81A1C1",
    green: "#A3BE8C",
    yellow: "#EBCB8B",
    red: "#BF616A",
    violet: "#B48EAD",
    selectedBg: "#ECEFF4",
    selectedText: "#4C566A",
    separator: "#3B4252",
    copyFlashBg: "#344735",
    copyFlashBgDim: "#303B34",
  },
  "one-half-dark": {
    screenBg: "#282C34",
    panelBg: "#282C34",
    text: "#DCDFE4",
    muted: "#DCDFE4",
    dim: "#5D677A",
    accent: "#61AFEF",
    green: "#98C379",
    yellow: "#E5C07B",
    red: "#E06C75",
    violet: "#C678DD",
    selectedBg: "#474E5D",
    selectedText: "#DCDFE4",
    separator: "#282C34",
    copyFlashBg: "#344531",
    copyFlashBgDim: "#303932",
  },
  rosepine: {
    screenBg: "#191724",
    panelBg: "#26233A",
    text: "#E0DEF4",
    muted: "#E0DEF4",
    dim: "#6E6A86",
    accent: "#9CCFD8",
    green: "#31748F",
    yellow: "#F6C177",
    red: "#EB6F92",
    violet: "#C4A7E7",
    selectedBg: "#403D52",
    selectedText: "#E0DEF4",
    separator: "#26233A",
    copyFlashBg: "#20383D",
    copyFlashBgDim: "#1D2F35",
  },
  solarized: {
    screenBg: "#002B36",
    panelBg: "#073642",
    text: "#839496",
    muted: "#93A1A1",
    dim: "#335E69",
    accent: "#268BD2",
    green: "#859900",
    yellow: "#B58900",
    red: "#DC322F",
    violet: "#D33682",
    selectedBg: "#073642",
    selectedText: "#93A1A1",
    separator: "#073642",
    copyFlashBg: "#144B3F",
    copyFlashBgDim: "#103D38",
  },
  synthwave84: {
    screenBg: "#000000",
    panelBg: "#000000",
    text: "#DAD9C7",
    muted: "#FFFFFF",
    dim: "#7F7094",
    accent: "#2186EC",
    green: "#1EBB2B",
    yellow: "#FDF834",
    red: "#F6188F",
    violet: "#F85A21",
    selectedBg: "#19CDE6",
    selectedText: "#000000",
    separator: "#7F7094",
    copyFlashBg: "#053A19",
    copyFlashBgDim: "#042910",
  },
  system: systemTheme,
  tokyonight: {
    screenBg: "#1A1B26",
    panelBg: "#15161E",
    text: "#C0CAF5",
    muted: "#A9B1D6",
    dim: "#414868",
    accent: "#7AA2F7",
    green: "#9ECE6A",
    yellow: "#E0AF68",
    red: "#F7768E",
    violet: "#BB9AF7",
    selectedBg: "#283457",
    selectedText: "#C0CAF5",
    separator: "#15161E",
    copyFlashBg: "#263D2B",
    copyFlashBgDim: "#202F27",
  },
  vercel: {
    screenBg: "#101010",
    panelBg: "#000000",
    text: "#FAFAFA",
    muted: "#FEFFFF",
    dim: "#A8A8A8",
    accent: "#006AFF",
    green: "#29A948",
    yellow: "#FFAE00",
    red: "#FC0036",
    violet: "#F32882",
    selectedBg: "#005BE7",
    selectedText: "#FAFAFA",
    separator: "#000000",
    copyFlashBg: "#123418",
    copyFlashBgDim: "#102615",
  },
  vesper: {
    screenBg: "#101010",
    panelBg: "#101010",
    text: "#FFFFFF",
    muted: "#A0A0A0",
    dim: "#7E7E7E",
    accent: "#ACA1CF",
    green: "#90B99F",
    yellow: "#E6B99D",
    red: "#F5A191",
    violet: "#E29ECA",
    selectedBg: "#988049",
    selectedText: "#B9BEB8",
    separator: "#101010",
    copyFlashBg: "#233228",
    copyFlashBgDim: "#1D2822",
  },
  zenburn: {
    screenBg: "#3F3F3F",
    panelBg: "#4D4D4D",
    text: "#DCDCCC",
    muted: "#DCDCCC",
    dim: "#709080",
    accent: "#5D6D7D",
    green: "#60B48A",
    yellow: "#F0DFAF",
    red: "#7D5D5D",
    violet: "#DC8CC3",
    selectedBg: "#21322F",
    selectedText: "#C2D87A",
    separator: "#4D4D4D",
    copyFlashBg: "#2E4939",
    copyFlashBgDim: "#2B3D34",
  },
};

export const colors: ThemeColors = { ...systemTheme };

export const setActiveTheme = (themeName: ThemeName) => {
  Object.assign(colors, themes[themeName]);
};

export const isThemeName = (value: string): value is ThemeName =>
  (themeNames as readonly string[]).includes(value);

export const normalizeThemeName = (value: string): ThemeName | null => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("catppuccinmacchiato")) return "catppuccin-macchiato";
  if (normalized.includes("catppuccin") || normalized.includes("mocha")) return "catppuccin-mocha";
  if (normalized.includes("dracula")) return "dracula";
  if (normalized.includes("everforest")) return "everforest-dark";
  if (normalized.includes("gruvbox")) return "gruvbox-dark";
  if (normalized.includes("kanagawa")) return "kanagawa-wave";
  if (normalized.includes("nord")) return "nord";
  if (normalized.includes("onehalfdark")) return "one-half-dark";
  if (normalized.includes("tokyonight") || normalized.includes("tokyo")) return "tokyonight";
  if (normalized.includes("rosepine") || normalized.includes("rosepinedawn")) return "rosepine";
  if (normalized.includes("solarized")) return "solarized";
  if (normalized.includes("synthwave")) return "synthwave84";
  if (normalized.includes("vercel")) return "vercel";
  if (normalized.includes("vesper")) return "vesper";
  if (normalized.includes("zenburn")) return "zenburn";
  if (normalized.includes("system") || normalized.includes("auto")) return "system";
  return null;
};

export const themeNamesMatching = (query: string): readonly ThemeName[] => {
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return themeNames;
  return themeNames.filter((name) => name.replace(/[^a-z0-9]/g, "").includes(normalized));
};

export const themeNameFromGhosttyConfig = (config: string): ThemeName | null => {
  for (const line of config.split(/\r?\n/)) {
    const uncommented = line.replace(/#.*/, "").trim();
    const match = /^theme\s*=\s*(.+)$/i.exec(uncommented);
    if (!match) continue;
    const themeName = normalizeThemeName(match[1] ?? "");
    if (themeName) return themeName;
  }
  return null;
};

export const inferThemeName = (input: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly ghosttyConfig?: string;
}): ThemeName | null => {
  const env = input.env ?? {};
  const explicit =
    env.DEVTUI_THEME ?? env.GHOSTTY_THEME ?? env.OPENCODE_THEME ?? env.THEME ?? env.COLOR_THEME;
  if (explicit) {
    const themeName = normalizeThemeName(explicit);
    if (themeName) return themeName;
  }
  if (input.ghosttyConfig) {
    const themeName = themeNameFromGhosttyConfig(input.ghosttyConfig);
    if (themeName) return themeName;
  }
  return null;
};

export const rgba = (hex: string) => RGBA.fromHex(hex);
