import { defineConfig } from "../src/config.ts";

const noisy = new URL("./noisy.ts", import.meta.url).pathname;

export default defineConfig({
  title: "devtui jsonl demo",
  logs: {
    storage: "jsonl",
    path: ".devtui/jsonl-demo.jsonl",
    maxEntries: 5_000,
  },
  processes: [
    {
      name: "api",
      command: `bun run ${noisy} api --delay 250 --fail-every 5`,
    },
    {
      name: "worker",
      command: `bun run ${noisy} worker --delay 400`,
    },
  ],
});
