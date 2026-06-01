import { defineConfig } from "../src/config.ts";

const noisy = new URL("./noisy.ts", import.meta.url).pathname;
const server = new URL("./server.ts", import.meta.url).pathname;
const webPort = 5173;
const apiPort = 8787;

export default defineConfig({
  title: "example: vanilla multi process",
  processes: [
    {
      name: "web",
      command: `bun run ${server} --name web --port ${webPort}`,
      env: {
        API_BASE_URL: `http://localhost:${apiPort}`,
        PORT: String(webPort),
      },
      endpoints: [
        {
          label: "web",
          port: webPort,
          source: "config",
          url: `http://localhost:${webPort}`,
        },
      ],
    },
    {
      name: "api",
      command: `bun run ${server} --name api --port ${apiPort} --fail-every 7`,
      env: { PORT: String(apiPort) },
      endpoints: [
        {
          label: "api",
          port: apiPort,
          source: "config",
          url: `http://localhost:${apiPort}`,
        },
      ],
    },
    {
      name: "worker",
      command: `bun run ${noisy} worker --delay 900 --fail-every 11`,
    },
  ],
});
