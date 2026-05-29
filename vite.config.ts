import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp fmt --write",
  },
  fmt: {
    ignorePatterns: ["repos/**"],
  },
  lint: {
    ignorePatterns: ["repos/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
  },
  run: {
    cache: true,
  },
});
