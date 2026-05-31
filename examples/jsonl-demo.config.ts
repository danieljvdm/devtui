import { defineConfig } from "../src/config.ts";

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
      command: "bun run examples/noisy.ts api --delay 250 --fail-every 5",
    },
    {
      name: "worker",
      command: "bun run examples/noisy.ts worker --delay 400",
    },
  ],
});
