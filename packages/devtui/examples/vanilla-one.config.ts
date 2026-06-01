import { defineConfig } from "../src/config.ts";

const server = new URL("./server.ts", import.meta.url).pathname;
const port = 5173;

export default defineConfig({
  title: "example: vanilla one process",
  processes: [
    {
      name: "web",
      command: `bun run ${server} --name web --port ${port}`,
      env: { PORT: String(port) },
      endpoints: [
        {
          label: "web",
          port,
          source: "config",
          url: `http://localhost:${port}`,
        },
      ],
    },
  ],
});
