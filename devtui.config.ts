import { defineConfig } from "./src/config.ts";

export default defineConfig({
  title: "devtui dogfood",
  logs: {
    storage: "memory",
    maxEntries: 5_000,
  },
  processes: [
    {
      name: "api",
      command: "bun run examples/noisy.ts api --delay 420 --fail-every 17",
    },
    {
      name: "web",
      command: "bun run examples/noisy.ts web --delay 650",
    },
    {
      name: "worker",
      command: "bun run examples/noisy.ts worker --delay 900 --fail-every 11",
    },
  ],
});
