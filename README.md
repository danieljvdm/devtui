# devtui

A Bun + OpenTUI process runner for local development.

The first cut can:

- run multiple long-lived commands in parallel
- switch between a merged log stream and individual process streams
- filter logs interactively
- restart or stop a selected process
- keep a bounded in-memory log buffer
- render only the visible log window with a scrollbar

## Commands

```sh
bun install
bun run dev
```

`bun run dev` is the dogfood command for this repo. The CLI implementation lives in `packages/devtui`, with the root package acting as the Vite Plus monorepo orchestrator. As a product, `devtui dev` is the canonical command: it loads `devtui.config.ts` when one exists, otherwise it auto-detects workspace packages with dev-capable scripts and runs one process per package.

Use the built-in demo explicitly when you want noisy sample processes:

```sh
bun run demo
```

The example testbed in `packages/devtui/examples` covers the process shapes devtui should keep supporting:

```sh
bun run example:one
bun run example:multi
bun run example:portless
```

Use `--print-plan` with any of those commands to inspect the resolved config without starting processes.

If there is no config file and no dev tasks are detected, `devtui` fails with a clear no-task message instead of silently running the demo.

## Auto Discovery

For a typical package or workspace repo:

```sh
devtui dev
```

Resolution priority is:

1. `devtui dev --demo`
2. `devtui dev --config ./x.ts`
3. local `devtui.config.ts`
4. auto-discovered workspace dev tasks
5. typed “no dev tasks detected” error

Useful inspection and override flags:

```sh
devtui dev --print-plan
devtui dev --print-config
devtui dev --dry-run
devtui dev --ignore-config
devtui dev --script start
devtui dev --include app --exclude docs
devtui dev --manager bun|pnpm|yarn|npm|auto
devtui dev --logs memory|jsonl|sqlite
```

Auto discovery currently supports package manager detection, package.json and pnpm workspace globs, per-package `scripts.dev` selection, direct package-local commands, Infisical detection through `.infisical.json`, and Portless enablement through `portless.json` or `--portless`.

## Config Escape Hatch

Use `devtui.config.ts` when auto-detection is wrong, when you need project-specific orchestration, or when you want to pin exact commands.

```ts
import { defineConfig, vitePlusRun, withEnv, withInfisical, withPortless } from "devtui/config";

export default defineConfig({
  title: "my app",
  logs: {
    storage: "memory",
    maxEntries: 5_000,
  },
  processes: [
    { name: "web", command: "bun run --cwd apps/web dev" },
    vitePlusRun("api", "api#dev"),
    { name: "worker", command: "bun run --cwd apps/worker dev" },
  ],
});
```

The preset helpers are intentionally small. They only produce `ProcessSpec` values, so they compose with the same runtime and `LogStore` layers as hand-written commands:

```ts
const api = withInfisical(
  withEnv(vitePlusRun("api", "api#dev", ["8787"]), {
    PERCORSO_API_PORT: "8787",
  }),
  { env: "dev", paths: ["/"], projectConfigDir: "." },
);
```

Portless can be layered the same way when a process should get a stable local URL:

```ts
const app = withPortless(withEnv(vitePlusRun("app", "app#dev"), { PORT: "5174" }), {
  name: "percorso",
  appPort: 5174,
  proxyPort: 1355,
  https: false,
  syncHosts: false,
});
```

`proxyPort` is useful for headless devtui/MCP sessions because Portless can start an unprivileged proxy without a sudo prompt. Omit it when you already run the standard Portless proxy on port 443.

Use `storage: "jsonl"` with `path: ".devtui/logs.jsonl"` to append structured log entries while keeping the TUI hot buffer in memory. `storage: "sqlite"` is reserved for the indexed query backend.

You can also pass a config explicitly:

```sh
devtui dev --config ./path/to/devtui.config.ts
```

## MCP

Run a headless stdio MCP server for the same process runner:

```sh
devtui-mcp
```

`devtui-mcp` uses the same resolver as `devtui dev`, so configless projects get the same auto plan in TUI and MCP modes. The MCP layer uses whichever `LogStore` layer the config or detected plan selects. Current tools:

- `devtui_status`
- `devtui_processes`
- `devtui_logs`
- `devtui_restart_process`
- `devtui_stop_process`
- `devtui_clear_logs`

The per-instance server registers itself in the local instance registry while it is running. Start the single broker server for agent clients that need to discover and bind to one of many devtui instances:

```sh
devtui-broker
```

Broker tools:

- `devtui_instances`
- `devtui_select_instance`
- `devtui_selected_instance`
- `devtui_broker_logs`
- `devtui_broker_restart_process`
- `devtui_broker_stop_process`
- `devtui_broker_clear_logs`

The current broker can discover/select instances, read logs from instances using `jsonl` storage, and route process-control commands through each instance's local control inbox. Set `DEVTUI_REGISTRY_DIR` to override the default registry directory at `~/.devtui/instances`.

## Percorso Sketch

[packages/devtui/examples/percorso.config.ts](/Users/dan/dev/devtui/packages/devtui/examples/percorso.config.ts) captures the first migration shape for `~/dev/percorso`: run `api#dev` and the app process directly under devtui, keep logs queryable through MCP, and leave port allocation/Portless as the next layer instead of burying process supervision inside the Vite plugin.

## Keys

- `ctrl-left/right/up/down` - move focus between the process selector and log pane
- `ctrl-h/j/k/l` - Vim-style pane focus where the terminal reports those chords distinctly
- `h/l`, `left/right` - focus the process selector or log pane without relying on terminal Ctrl-arrow support
- `j/k`, `up/down` - move inside the focused pane
- `tab` - switch between merged and process views
- `p` - open or close the process picker
- `1-9` - jump to a process
- `/` - enter log filter mode
- `L` - cycle log level filter (`all`, `error`, `warn`, `info`, `system`)
- `enter` - leave filter mode and keep the filter
- `esc` - clear filters, leave filter mode, or return to merged view
- `ctrl-u/ctrl-d`, `pageup/pagedown` - scroll logs
- mouse wheel/trackpad - scroll logs
- `G`, `end` - resume following the live log stream
- `c` - copy the selected log line when the log pane is focused
- `r` - restart selected process
- `x` - stop selected process
- `C` - clear logs
- `q` - quit and stop child processes

### tmux notes

tmux can intercept keys before devtui receives them. If you use vim-tmux-navigator-style bindings, `C-h` and `C-l` may be bound to `select-pane` unless `pane_current_command` matches an allowlist. When running with Bun, tmux sees the command as `bun`, so those keys will not reach devtui unless your tmux binding forwards them for this pane.

In that setup, plain `h/l` and `left/right` are the reliable in-app pane focus keys. To make `C-h/j/k/l` work inside devtui, add `devtui` or `bun` to the tmux navigator allowlist, or bind those keys to `send-keys` for the devtui pane before falling back to `select-pane`.
