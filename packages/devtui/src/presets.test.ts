import { describe, expect, test } from "bun:test";
import { command, vitePlusRun, withEnv, withInfisical, withPortless } from "./presets.ts";

describe("process presets", () => {
  test("quotes shell command parts", () => {
    expect(command(["vp", "run", "api#dev", "--", "A=B C"])).toBe("vp run 'api#dev' -- 'A=B C'");
  });

  test("builds vite-plus run specs", () => {
    expect(vitePlusRun("api", "api#dev", ["8787"])).toEqual({
      name: "api",
      command: "vp run 'api#dev' -- 8787",
      cwd: undefined,
      env: undefined,
    });
  });

  test("layers process env without changing command", () => {
    expect(withEnv(vitePlusRun("app", "app#dev"), { PORT: "5173" })).toEqual({
      name: "app",
      command: "vp run 'app#dev'",
      cwd: undefined,
      env: { PORT: "5173" },
    });
  });

  test("wraps a process with infisical", () => {
    expect(
      withInfisical(vitePlusRun("api", "api#dev"), {
        env: "dev",
        paths: ["/", "/runtime"],
        projectConfigDir: ".",
        watch: false,
      }).command,
    ).toBe(
      "infisical run --project-config-dir . --env dev --path / --path /runtime -- vp run 'api#dev'",
    );
  });

  test("keeps process env out of the logged command when wrapping with infisical", () => {
    expect(
      withInfisical(
        withEnv(vitePlusRun("api", "api#dev"), {
          API_PORT: "8787",
          API_INSPECTOR_PORT: "9233",
        }),
        {
          env: "dev",
          paths: ["/"],
          projectConfigDir: ".",
          watch: false,
        },
      ),
    ).toEqual({
      name: "api",
      command: "infisical run --project-config-dir . --env dev --path / -- vp run 'api#dev'",
      cwd: undefined,
      env: {
        API_INSPECTOR_PORT: "9233",
        API_PORT: "8787",
      },
    });
  });

  test("wraps a process with portless", () => {
    expect(
      withPortless(vitePlusRun("app", "app#dev"), {
        appPort: 5174,
        name: "web",
      }),
    ).toEqual({
      name: "app",
      command: "portless run --name web --app-port 5174 vp run 'app#dev'",
      cleanupCommand: "portless proxy stop",
      cwd: undefined,
      env: undefined,
    });
  });

  test("adds portless proxy env when configured for a headless proxy", () => {
    expect(
      withPortless(withEnv(vitePlusRun("app", "app#dev"), { PORT: "5174" }), {
        appPort: 5174,
        https: false,
        name: "web",
        proxyPort: 1355,
        syncHosts: false,
      }),
    ).toEqual({
      name: "app",
      command: "portless run --name web --app-port 5174 vp run 'app#dev'",
      cleanupCommand: "portless proxy stop",
      cwd: undefined,
      env: {
        PORT: "5174",
        PORTLESS_HTTPS: "0",
        PORTLESS_PORT: "1355",
        PORTLESS_SYNC_HOSTS: "0",
      },
    });
  });
});
