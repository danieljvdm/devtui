import {
  defineConfig,
  process as devProcess,
  vitePlusRun,
  withEnv,
  withPortless,
} from "../src/config.ts";

const apiPort = "8787";
const apiInspectorPort = "9233";
const appPort = "5174";
const usePortless = process.env.PERCORSO_PORTLESS === "1";
const portlessProxyPort = process.env.PERCORSO_PORTLESS_PROXY_PORT ?? "1355";

const maybePortless = <A extends Parameters<typeof withPortless>[0]>(spec: A): A =>
  usePortless
    ? (withPortless(spec, {
        appPort,
        https: process.env.PERCORSO_PORTLESS_HTTPS === "1",
        name: "percorso",
        proxyPort: portlessProxyPort,
        syncHosts: false,
      }) as A)
    : spec;

export default defineConfig({
  title: "percorso",
  logs: {
    storage: "jsonl",
    path: ".devtui/percorso.jsonl",
  },
  processes: [
    withEnv(vitePlusRun("api", "api#dev", [apiPort, apiInspectorPort]), {
      PERCORSO_API_INSPECTOR_PORT: apiInspectorPort,
      PERCORSO_API_PORT: apiPort,
    }),
    maybePortless(
      withEnv(devProcess("app", ["vp", "dev", "apps/app", "--port", appPort, "--strictPort"]), {
        PERCORSO_APP_PORT: appPort,
        VITE_API_BASE_URL: `http://localhost:${apiPort}`,
      }),
    ),
  ],
});
