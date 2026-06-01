# devtui spec

## Purpose

`devtui` runs local development processes in parallel and gives developers and agents a live, queryable view of their logs.

## Current MVP

- load a typed `devtui.config.ts`
- start configured commands in parallel
- capture stdout and stderr as structured log entries
- show merged logs and per-process logs
- filter logs in the TUI by text and log level
- virtualize the log viewport and show a scroll position indicator
- pause live following when the user scrolls away from the bottom
- focus the process selector or log pane independently
- navigate and copy individual log lines from the focused log pane
- stop, restart, and clear process logs

## Architecture

- Effect CLI program on Bun
- `@effect/platform-bun` supplies filesystem, path, stdio, terminal, and child process services
- runtime state is owned by Effect services
- log persistence and querying go through a `LogStore` Effect service
- rendering observes snapshots and dispatches commands
- React/OpenTUI does not own process lifecycle or log ingestion

## Layout

The TUI should respond to terminal dimensions rather than assuming one fixed layout:

- wide layouts use a left process rail and a main log pane
- medium layouts may show process selection above logs
- compact layouts hide the process selector and use a process picker opened with `p`
- the title/header must not render on the first terminal row without vertical breathing room
- text must truncate inside its pane instead of bleeding into neighboring panes
- the log pane renders only visible rows and a narrow scrollbar when the filtered log set exceeds the viewport
- scrolling with a trackpad, mouse wheel, `ctrl-u/d`, or page keys anchors the viewport so new logs do not move the visible rows
- `ctrl-left/right/up/down` moves pane focus; `ctrl-h/j/k/l` is supported where the terminal reports those chords distinctly
- `h/l` and `left/right` move focus between the process selector and log pane as reliable in-app fallbacks
- `j/k` navigate the focused pane
- under tmux, intercepted pane-navigation bindings are outside devtui's control; the app only handles keys that tmux forwards to the process
- copying logs should run through an Effect clipboard service, not direct renderer APIs
- `G` and `end` resume following the live stream

## Log Storage

The TUI should keep a bounded hot buffer for fast rendering and scrolling. That buffer is runtime state owned by `LogStore`, exposed through `SubscriptionRef`, and should stay small enough that repainting remains cheap.

The runner should not treat that hot buffer as the long-term source of truth. Log ingestion must go through the `LogStore` service:

- append structured log entries from process streams
- query by process, text, severity, time range, and cursor
- expose recent snapshots for the TUI
- support retention policy decisions outside the renderer
- allow storage strategy selection through layers

Current layers:

- `LogStore.layerMemory` for the default bounded hot buffer
- `LogStore.layerJsonl` for append-only JSONL plus the hot buffer
- `LogStore.layerSqlite` is reserved for the indexed backend and should become the default once MCP/log querying needs indexed process, severity, timestamp, and text queries

## Future Capabilities

- MCP server for agents to inspect logs, processes, filters, and recent failures
- Portless integration for process URL/port discovery
- env injector integration, starting with Infisical-style command wrapping
- persistent or pluggable log retention
- structured query language for merged and per-process logs
- process dependency graph and task grouping

## MCP Architecture

The first MCP service is a per-instance stdio server:

- `devtui-mcp --config ./devtui.config.ts` starts the same Effect process runner as the TUI without rendering React/OpenTUI
- the MCP toolkit is registered through `McpServer.toolkit(...).pipe(Layer.provideMerge(...))`, following Motel's layer shape
- handlers depend on the `LogStore` service and the `ProcessRunner`, so `LogStore.layerMemory`, `LogStore.layerJsonl`, and the future SQLite layer can be swapped without changing MCP tools
- stdout is reserved for MCP JSON-RPC responses; child-process logs go into `LogStore`

This model works when the agent is attached to one project. The broker MCP service handles the "Codex connects to one server but I have many devtui instances" workflow.

Current broker behavior:

- each TUI or headless runner writes a heartbeat file containing `{ instanceId, cwd, title, startedAtMs, updatedAtMs, storage, logPath, processes }`
- each instance also owns a local control inbox under the registry directory
- `devtui-broker` exposes `devtui_instances`, `devtui_select_instance`, `devtui_selected_instance`, `devtui_broker_logs`, `devtui_broker_restart_process`, `devtui_broker_stop_process`, and `devtui_broker_clear_logs`
- broker log queries work for `jsonl` instances because the broker can read the shared append-only log file
- memory-only instances are discoverable, but their hot buffers remain in-process and are not yet readable by the broker
- broker process-control tools enqueue commands for the owning runner; the runner executes lifecycle changes from inside its existing Effect process service

Next broker step:

- add a local per-instance IPC endpoint so the broker can synchronously proxy the full process/log toolkit and read memory-backed hot logs
- stale registrations should be removed by heartbeat/lease expiry even if a process dies without running finalizers
- the broker should not own process lifecycle; it routes to per-instance services so each project can keep its own config, log store, and retention policy

## Presets And Integrations

The public config surface should stay boring:

- `defineConfig({ processes })` remains the stable core API
- helpers such as `vitePlusRun`, `vitePlusDev`, `withEnv`, `withInfisical`, and `withPortless` only build `ProcessSpec` values
- `withPortless` can set Portless environment such as `PORTLESS_PORT`, `PORTLESS_HTTPS`, and `PORTLESS_SYNC_HOSTS` so headless MCP sessions can use an unprivileged proxy without sudo
- detection can layer on top later by reading package scripts, Vite Plus task metadata, Turborepo pipelines, or Portless app declarations and returning the same config shape
- Portless should eventually provide URL/port metadata to both the TUI and MCP status tools, not be hidden inside command strings

Percorso is the proving ground:

- current `~/dev/percorso` root dev flow is implemented inside `vite.config.ts` as a Vite Plus plugin that spawns `api#dev` and an internal app server, prefixes logs, allocates ports, wraps Infisical, and proxies traffic
- the devtui replacement should move child-process spawning and log prefixing out of the Vite plugin and into `devtui`
- first migration can use fixed or env-provided ports with `vitePlusRun("api", "api#dev", [...])` and an app process command
- the next migration should use Portless or a devtui port service for allocation/discovery, then expose the chosen URLs in `devtui_status`
