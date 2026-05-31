import { afterEach, describe, expect, test } from "bun:test";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Exit } from "effect";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatConfig,
  formatPlan,
  layerPortAllocator,
  layerPortlessIntegration,
  layerProjectDiscovery,
  resolveConfig,
} from "./config.ts";
import * as InfisicalIntegration from "./core/infisical.ts";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const tempProjects: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
  for (const project of tempProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

const makeProject = () => {
  const root = mkdtempSync(join(tmpdir(), "devtui-config-"));
  tempProjects.push(root);
  process.chdir(root);
  return process.cwd();
};

const writeJson = (path: string, value: unknown) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const runResolve = (
  argv: readonly string[],
  options: { readonly infisicalAvailable?: boolean } = {},
) =>
  Effect.runPromise(
    resolveConfig(argv).pipe(
      Effect.provide(layerProjectDiscovery),
      Effect.provide(
        InfisicalIntegration.layerFake({ available: options.infisicalAvailable ?? true }),
      ),
      Effect.provide(layerPortAllocator),
      Effect.provide(layerPortlessIntegration),
      Effect.provide(BunServices.layer),
    ),
  );

const runResolveExit = (
  argv: readonly string[],
  options: { readonly infisicalAvailable?: boolean } = {},
) =>
  Effect.runPromiseExit(
    resolveConfig(argv).pipe(
      Effect.provide(layerProjectDiscovery),
      Effect.provide(
        InfisicalIntegration.layerFake({ available: options.infisicalAvailable ?? true }),
      ),
      Effect.provide(layerPortAllocator),
      Effect.provide(layerPortlessIntegration),
      Effect.provide(BunServices.layer),
    ),
  );

describe("config resolution", () => {
  test("--demo is the only implicit demo path", async () => {
    makeProject();

    const resolved = await runResolve(["dev", "--demo"]);

    expect(resolved.source).toBe("demo");
    expect(resolved.config.title).toBe("devtui demo");
    expect(resolved.config.processes.map((process) => process.name)).toEqual([
      "api",
      "web",
      "worker",
    ]);
  });

  test("local devtui.config.ts wins over auto detection", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });
    writeFileSync(
      join(root, "devtui.config.ts"),
      "export default { title: 'configured', processes: [{ name: 'configured', command: 'bun run configured' }] }\n",
    );

    const resolved = await runResolve(["dev"]);

    expect(resolved.source).toBe("explicit");
    expect(resolved.config.title).toBe("configured");
    expect(resolved.config.processes.map((process) => process.name)).toEqual(["configured"]);
  });

  test("--ignore-config forces auto detection", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });
    writeFileSync(
      join(root, "devtui.config.ts"),
      "export default { title: 'configured', processes: [{ name: 'configured', command: 'bun run configured' }] }\n",
    );

    const resolved = await runResolve(["dev", "--ignore-config"]);

    expect(resolved.source).toBe("detected");
    expect(resolved.plan?.packageManager).toBe("bun");
    expect(resolved.config.processes).toEqual([
      {
        name: "app",
        command: "bun run dev",
        cwd: join(root, "apps", "app"),
        env: { PORT: "5173" },
        endpoints: [{ label: "app", url: "http://localhost:5173", port: 5173, source: "detected" }],
      },
    ]);
  });

  test("detects workspace dev scripts as independent process specs", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    mkdirSync(join(root, "packages", "lib"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "pnpm@10.0.0",
      workspaces: ["apps/*", "packages/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });
    writeJson(join(root, "packages", "lib", "package.json"), {
      name: "lib",
      scripts: { check: "tsc --noEmit" },
    });

    const resolved = await runResolve(["dev"]);

    expect(resolved.source).toBe("detected");
    expect(resolved.plan?.workspaceGlobs).toEqual(["apps/*", "packages/*"]);
    expect(resolved.plan?.processes.map((process) => [process.name, process.kind])).toEqual([
      ["api", "api"],
      ["app", "app"],
    ]);
    expect(
      resolved.config.processes.map((process) => ({
        name: process.name,
        command: process.command,
        cwd: process.cwd,
        env: process.env,
        endpoints: process.endpoints,
      })),
    ).toEqual([
      {
        name: "api",
        command: "pnpm run dev",
        cwd: join(root, "apps", "api"),
        env: { PORT: "8787" },
        endpoints: [{ label: "api", url: "http://localhost:8787", port: 8787, source: "detected" }],
      },
      {
        name: "app",
        command: "pnpm run dev",
        cwd: join(root, "apps", "app"),
        env: { PORT: "5173" },
        endpoints: [{ label: "app", url: "http://localhost:5173", port: 5173, source: "detected" }],
      },
    ]);
  });

  test("skips invalid workspace package manifests", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    mkdirSync(join(root, "apps", "broken"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });
    writeFileSync(join(root, "apps", "broken", "package.json"), "{ invalid json");

    const resolved = await runResolve(["dev"]);

    expect(resolved.config.processes.map((process) => process.name)).toEqual(["app"]);
  });

  test("no config and no dev scripts fails instead of running demo", async () => {
    const root = makeProject();
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      scripts: { check: "tsc --noEmit" },
    });

    const exit = await runResolveExit(["dev"]);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("NoDevTasksDetectedError");
    }
  });

  test("formats detected plans for dry runs", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "npm@11.0.0",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { start: "vite --host 0.0.0.0" },
    });

    const resolved = await runResolve(["dev", "--script", "start"]);

    expect(resolved.plan ? formatPlan(resolved.plan) : "").toContain("package manager: npm");
    expect(resolved.plan ? formatPlan(resolved.plan) : "").toContain(
      "app  apps/app  npm run start",
    );
    expect(resolved.plan ? formatPlan(resolved.plan) : "").toContain(
      "app app: 5173 http://localhost:5173",
    );
  });

  test("supports logs flag and explicit config export formatting", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev", "--logs", "jsonl"]);

    expect(resolved.config.logs).toEqual({ storage: "jsonl" });
    expect(formatConfig(resolved.config)).toContain(`export default defineConfig({`);
    expect(formatConfig(resolved.config)).toContain(`"storage": "jsonl"`);
  });

  test("explicit env port wins for a single detected process", async () => {
    const root = makeProject();
    process.env.PORT = "4321";
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(resolved.config.processes[0].env).toEqual({ PORT: "4321" });
    expect(resolved.config.processes[0].endpoints).toEqual([
      { label: "app", url: "http://localhost:4321", port: 4321, source: "detected" },
    ]);
  });

  test("named env port overrides are applied before defaults", async () => {
    const root = makeProject();
    process.env.DEVTUI_PORT_API = "9000";
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(
      resolved.config.processes.map((process) => [process.name, process.env, process.endpoints]),
    ).toEqual([
      [
        "api",
        { PORT: "9000" },
        [{ label: "api", url: "http://localhost:9000", port: 9000, source: "detected" }],
      ],
      [
        "app",
        { PORT: "5173" },
        [{ label: "app", url: "http://localhost:5173", port: 5173, source: "detected" }],
      ],
    ]);
  });

  test("single-package repos use the root dev script", async () => {
    const root = makeProject();
    writeJson(join(root, "package.json"), {
      packageManager: "yarn@4.0.0",
      name: "solo",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(resolved.source).toBe("detected");
    expect(resolved.config.processes).toEqual([
      {
        name: "solo",
        command: "yarn dev",
        cwd: root,
        env: { PORT: "5173" },
        endpoints: [{ label: "app", url: "http://localhost:5173", port: 5173, source: "detected" }],
      },
    ]);
  });

  test("recursive devtui scripts are not selected as child processes", async () => {
    const root = makeProject();
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      name: "recursive",
      scripts: { dev: "devtui dev" },
    });

    const exit = await runResolveExit(["dev"]);

    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("infisical detection wraps process commands without serializing env values", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, ".infisical.json"), {});
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });

    const resolved = await runResolve([
      "dev",
      "--infisical-env",
      "staging",
      "--infisical-path",
      "/",
      "--infisical-path",
      "/runtime",
    ]);

    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "infisical")?.enabled,
    ).toBe(true);
    expect(resolved.config.processes[0].command).toBe(
      `infisical run --project-config-dir ${root} --env staging --path / --path /runtime -- bun run dev`,
    );
    expect(resolved.config.processes[0].env).toEqual({ PORT: "8787" });
    expect(resolved.config.processes[0].endpoints).toEqual([
      { label: "api", url: "http://localhost:8787", port: 8787, source: "detected" },
    ]);
  });

  test("auto infisical missing CLI emits a diagnostic and continues without wrapping", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, ".infisical.json"), {});
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });

    const resolved = await runResolve(["dev"], { infisicalAvailable: false });

    expect(resolved.config.processes[0].command).toBe("bun run dev");
    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "infisical"),
    ).toEqual({
      name: "infisical",
      enabled: false,
      reason: "infisical CLI unavailable",
    });
    expect(
      resolved.diagnostics.some(
        (diagnostic) =>
          diagnostic.level === "warn" &&
          diagnostic.message.includes("infisical CLI is not available"),
      ),
    ).toBe(true);
  });

  test("required infisical missing CLI fails clearly", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });

    const exit = await runResolveExit(["dev", "--infisical"], { infisicalAvailable: false });

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("Infisical was required with --infisical");
    }
  });

  test("infisical watch flag is included only when requested", async () => {
    const root = makeProject();
    process.env.DEVTUI_INFISICAL_WATCH = "1";
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, ".infisical.json"), {});
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(resolved.config.processes[0].command).toBe(
      `infisical run --project-config-dir ${root} --env dev --path / --watch -- bun run dev`,
    );
  });

  test("DEVTUI_INFISICAL=0 disables automatic infisical wrapping", async () => {
    const root = makeProject();
    process.env.DEVTUI_INFISICAL = "0";
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeJson(join(root, ".infisical.json"), {});
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "infisical")?.enabled,
    ).toBe(false);
    expect(resolved.config.processes[0].command).toBe("bun run dev");
    expect(resolved.config.processes[0].endpoints).toEqual([
      { label: "api", url: "http://localhost:8787", port: 8787, source: "detected" },
    ]);
  });

  test("portless wraps app tasks only when enabled", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["portless", "dev"]);

    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "portless")?.enabled,
    ).toBe(true);
    expect(resolved.plan?.processes.find((process) => process.name === "app")?.endpoints).toEqual([
      { label: "app", url: "http://localhost:5173", port: 5173, source: "portless" },
    ]);
    expect(resolved.config.processes.map((process) => [process.name, process.command])).toEqual([
      ["api", "bun run dev"],
      ["app", "portless run --name app --app-port 5173 bun run dev"],
    ]);
  });

  test("--portless enables the portless integration", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev", "--portless"]);

    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "portless"),
    ).toEqual({
      name: "portless",
      enabled: true,
      reason: "--portless",
    });
    expect(resolved.config.processes[0].command).toBe(
      "portless run --name app --app-port 5173 bun run dev",
    );
    expect(resolved.config.processes[0].endpoints).toEqual([
      { label: "app", url: "http://localhost:5173", port: 5173, source: "portless" },
    ]);
  });

  test("portless.json auto-enables and --no-portless disables it", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "portless.json"), {});
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const autoResolved = await runResolve(["dev"]);
    const disabledResolved = await runResolve(["dev", "--no-portless"]);

    expect(
      autoResolved.plan?.integrations.find((integration) => integration.name === "portless"),
    ).toEqual({
      name: "portless",
      enabled: true,
      reason: "portless.json",
    });
    expect(autoResolved.config.processes[0].command).toBe(
      "portless run --name app --app-port 5173 bun run dev",
    );
    expect(
      disabledResolved.plan?.integrations.find((integration) => integration.name === "portless"),
    ).toEqual({
      name: "portless",
      enabled: false,
      reason: "disabled",
    });
    expect(disabledResolved.config.processes[0].command).toBe("bun run dev");
    expect(disabledResolved.config.processes[0].endpoints).toEqual([
      { label: "app", url: "http://localhost:5173", port: 5173, source: "detected" },
    ]);
  });

  test("portless dependency presence alone does not enable wrapping", async () => {
    const root = makeProject();
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
      devDependencies: { portless: "latest" },
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev"]);

    expect(
      resolved.plan?.integrations.find((integration) => integration.name === "portless"),
    ).toEqual({
      name: "portless",
      enabled: false,
      reason: "no portless.json",
    });
    expect(resolved.config.processes[0].command).toBe("bun run dev");
    expect(resolved.config.processes[0].endpoints).toEqual([
      { label: "app", url: "http://localhost:5173", port: 5173, source: "detected" },
    ]);
  });

  test("PORTLESS env options are added to wrapped app specs", async () => {
    const root = makeProject();
    process.env.PORTLESS_PORT = "3030";
    process.env.PORTLESS_HTTPS = "1";
    process.env.PORTLESS_SYNC_HOSTS = "0";
    process.env.PORTLESS_STATE_DIR = join(root, ".portless-state");
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeJson(join(root, "package.json"), {
      packageManager: "bun@1.3.9",
      workspaces: ["apps/*"],
    });
    writeJson(join(root, "apps", "api", "package.json"), {
      name: "api",
      scripts: { dev: "wrangler dev" },
    });
    writeJson(join(root, "apps", "app", "package.json"), {
      name: "app",
      scripts: { dev: "vite dev" },
    });

    const resolved = await runResolve(["dev", "--portless"]);

    expect(resolved.config.processes.map((process) => [process.name, process.env])).toEqual([
      ["api", { PORT: "8787" }],
      [
        "app",
        {
          PORT: "5173",
          PORTLESS_PORT: "3030",
          PORTLESS_HTTPS: "1",
          PORTLESS_SYNC_HOSTS: "0",
          PORTLESS_STATE_DIR: join(root, ".portless-state"),
        },
      ],
    ]);
  });
});
