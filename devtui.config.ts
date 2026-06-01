import { defineConfig } from "devtui/config";

export default defineConfig({
  title: "devtui dogfood",
  logs: {
    storage: "memory",
    maxEntries: 5_000,
  },
  processes: [
    {
      name: "api",
      command: "bun run packages/devtui/examples/noisy.ts api --delay 420 --fail-every 17",
    },
    {
      name: "web",
      command: "bun run packages/devtui/examples/noisy.ts web --delay 650",
    },
    {
      name: "worker",
      command: "bun run packages/devtui/examples/noisy.ts worker --delay 900 --fail-every 11",
    },
  ],
});
