import { defineConfig, withPortless } from "../src/config.ts";

const noisy = new URL("./noisy.ts", import.meta.url).pathname;
const server = new URL("./server.ts", import.meta.url).pathname;
const webPort = 5174;
const apiPort = 8787;

const portlessProxyPort = process.env.PORTLESS_PORT ?? "1355";

export default defineConfig({
  title: "example: portless multi process",
  processes: [
    withPortless(
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
            source: "portless",
            url: `http://localhost:${webPort}`,
          },
        ],
      },
      {
        appPort: webPort,
        https: process.env.PORTLESS_HTTPS === "1",
        name: "devtui-example",
        proxyPort: portlessProxyPort,
        stateDir: process.env.PORTLESS_STATE_DIR,
        syncHosts: process.env.PORTLESS_SYNC_HOSTS === "1",
      },
    ),
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
