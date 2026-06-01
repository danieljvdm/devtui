## Recommendation

Make **auto-discovery the default config source** for `devtui dev`, and keep `devtui.config.ts` as an explicit override rather than the happy path.

The key architectural move is small but important: replace today’s `loadConfig(argv): Effect<DevtuiConfig>` behavior of “explicit config or demo” with a resolver that can return:

```ts
resolved config = explicit config | detected dev plan | demo only when explicitly requested
```

Everything should still lower into the existing runtime contract: `DevtuiConfig` + `ProcessSpec[]` → `makeProcessRunner` → `LogStore` → TUI/MCP. Discovery should be a new Effect service/layer, not React state and not ad hoc CLI code.

---

## What the current repo already gets right

The selected code has a good seam for this:

`src/config.ts` is currently responsible for `--demo`, `--config/-c`, `devtui.config.ts`, and fallback demo. That should become the **config resolution seam**.

`src/core/domain.ts` already has a deliberately boring stable shape:

```ts
DevtuiConfig {
  title?
  logs?
  processes: ProcessSpec[]
}

ProcessSpec {
  name
  command
  cwd?
  env?
}
```

That is exactly what auto-detection should initially target.

`src/core/runner.ts` already owns lifecycle, logs, process status, restart/stop/clear, and `SubscriptionRef` snapshots. Keep it that way.

`src/presets.ts` already models integrations as process-spec transforms: `withInfisical`, `withPortless`, `withEnv`, `vitePlusRun`, `vitePlusDev`. Auto-discovery can produce the same specs first, then later move toward richer launch metadata.

The main thing that should change: **absence of `devtui.config.ts` should not mean demo**. It should mean “detect project dev tasks.”

---

## Proposed product contract

### Canonical command

```sh
devtui dev
```

This should:

1. Find the project/workspace root.
2. Detect package manager and workspace packages.
3. Find dev-capable packages.
4. Build one devtui process per selected package/task.
5. Detect optional integrations such as Infisical and Portless.
6. Run the processes under the existing Effect runner.
7. Show a visible “auto plan” summary in the TUI header or startup system logs.

`devtui` with no subcommand can remain an alias for `devtui dev` for compatibility, but the conceptual product should be `devtui dev`.

### Explicit config remains the escape hatch

Priority should be:

1. `devtui dev --demo` → demo only.
2. `devtui dev --config ./x.ts` → explicit config.
3. Local `devtui.config.ts` → explicit config.
4. No config → auto-discovered config.
5. No auto plan → clear “no dev tasks found” error, not noisy demo.

Add:

```sh
devtui dev --auto
devtui dev --ignore-config
```

Those let users test the magic even when a legacy `devtui.config.ts` exists.

### Trust/debug commands

Magic needs observability. Add a dry-run/explain mode before broadening heuristics:

```sh
devtui dev --print-plan
devtui dev --dry-run
```

This should print:

```txt
devtui auto plan
root: /Users/dan/dev/app
package manager: bun, from packageManager=bun@1.3.9
workspaces: apps/*, packages/*
selected processes:
  api  apps/api  bun run dev -- <apiPort> <inspectorPort>
  app  apps/app  vp dev --port <appPort> --strictPort
integrations:
  infisical: enabled, projectConfigDir=., env=dev, paths=/
  portless: disabled
ports:
  api: 8787
  api inspector: 9233
  app: 5174
```

Do not require users to write this to a config file.

---

## Core concepts/interfaces to add

These are conceptual interfaces, not implementation code.

### `ResolvedDevtuiConfig`

`loadConfig` should become something closer to `resolveConfig`:

```ts
ResolvedDevtuiConfig {
  config: DevtuiConfig
  source: "explicit" | "detected" | "demo"
  root: string
  diagnostics: PlanDiagnostic[]
  plan?: DevPlan
}
```

The runner still receives `config`. The UI/MCP can optionally receive `source` and `diagnostics`.

### `ProjectDiscovery`

Effect service responsible for reading the filesystem and manifests:

```ts
ProjectDiscovery {
  discover(cwd): Effect<ProjectInfo, DiscoveryError>
}
```

It should detect:

- git/project root
- nearest/root `package.json`
- package manager
- workspace globs
- workspace packages
- scripts
- lockfiles
- relevant tool files such as `.infisical.json`, `portless.json`, `wrangler.jsonc`, `vite.config.ts`

This belongs in core Effect services, using `FileSystem`, `Path`, and tagged errors. No React involvement.

### `PackageManagerAdapter`

Do not hard-code `bun` everywhere. Use an adapter selected by detection:

```ts
PackageManagerAdapter {
  name: "bun" | "pnpm" | "yarn" | "npm"
  runScriptCommand(pkg, script, args): CommandPlan
}
```

The package managers all have workspace script capabilities: Bun supports workspace scripts via `--filter` and `--workspaces`; pnpm has recursive workspace commands; Yarn has `workspaces foreach`; npm supports running scripts in configured workspaces. ([Bun][1])

But devtui should usually **not** run those recursive commands as a single child process. It should use package-manager knowledge to discover packages, then create **one `ProcessSpec` per package**. That preserves devtui’s value: independent logs, restart, stop, status, MCP controls, and future endpoint metadata.

Use package-manager recursive/delegate commands only as fallback or explicit mode:

```sh
devtui dev --delegate
```

### `DevTaskDetector`

Responsible for turning discovered packages into candidate dev tasks:

```ts
DevTask {
  id
  name
  cwd
  script
  command
  kind: "app" | "api" | "worker" | "library" | "unknown"
  confidence
  reasons
  capabilities
}
```

Capabilities matter more than labels:

```ts
capabilities:
  providesHttp?: true
  needsPort?: true
  needsInspectorPort?: true
  needsSecrets?: true
  supportsStrictPort?: true
  supportsPortless?: true
```

This is how Portless, Infisical, port allocation, and UI/MCP endpoint metadata avoid being hidden inside command strings.

### `IntegrationPlanner`

Separate integration detection from task detection:

```ts
IntegrationPlanner {
  plan(project, tasks, flags): Effect<IntegrationPlan, IntegrationError>
}
```

Initial integrations:

- Infisical
- Portless
- port allocation
- env materialization / env-file bridging
- future framework-specific metadata

### `LaunchPlan`

Current `ProcessSpec.command` is a shell string. That is okay for the first auto-discovery pass, because it preserves the runner contract. But internally, detection should prefer an argv/env representation and only lower to a shell command at the last boundary.

Current public API can stay:

```ts
{
  (name, command, cwd, env);
}
```

Internal auto plan should be richer:

```ts
LaunchPlan {
  displayCommand
  argv | shellCommand
  cwd
  env
  secretEnv
  endpoints
  finalizers
}
```

That gives you room to stop concatenating nested shell wrappers forever.

---

## Command behavior

### `devtui dev`

Default behavior:

- If `devtui.config.ts` exists, load it.
- Otherwise auto-detect.
- Start all detected dev tasks in parallel.
- Use current TUI.
- Keep process-level restart/stop/clear.
- Emit system logs explaining auto decisions.

### `devtui-mcp`

This should use the same resolver as `devtui dev`.

Today `src/mcp.ts` calls `loadConfig(args)`, which means MCP also requires config or demo. That should become configless too:

```sh
devtui-mcp
```

should discover the same plan as:

```sh
devtui dev
```

This matters because agents should not need a hand-authored `devtui.config.ts` either.

### `devtui portless dev`

I would support this as sugar, but not make it the primary model.

Canonical:

```sh
devtui dev --portless
```

Alias:

```sh
devtui portless dev
```

Portless is an integration policy, not a separate runner mode. Keeping it as a flag/submode avoids forking the runtime architecture.

### Useful flags

```sh
devtui dev --script dev
devtui dev --script start
devtui dev --include app --include api
devtui dev --exclude docs
devtui dev --manager bun|pnpm|yarn|npm|auto
devtui dev --prefer packages|root|auto
devtui dev --infisical
devtui dev --no-infisical
devtui dev --infisical-env dev
devtui dev --infisical-path /
devtui dev --portless
devtui dev --no-portless
devtui dev --logs memory|jsonl|sqlite
devtui dev --print-plan
```

No prompts are needed for the happy path.

---

## Detection strategy

### 1. Find the root

Walk upward from `cwd` and score possible roots:

- `package.json`
- `packageManager`
- workspace declarations
- lockfiles
- `.git`
- `pnpm-workspace.yaml`
- `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`

Precedence for package manager:

1. `packageManager` field.
2. Lockfile.
3. Workspace-specific files.
4. CLI override.
5. Fallback to the binary used to launch devtui only if nothing else is known.

### 2. Enumerate workspaces

Support:

- `package.json#workspaces` array
- `package.json#workspaces.packages`
- `pnpm-workspace.yaml`
- single-package repos with no workspaces

Ignore:

- `node_modules`
- hidden build/cache dirs
- package dirs without `package.json`

### 3. Select dev tasks

Default rule:

- include every workspace package with `scripts.dev`
- include root `scripts.dev` only if it is not an aggregate/recursive/devtui wrapper and no better package-level decomposition exists

Important recursion guard:

If a root script is:

```json
"dev": "devtui"
```

or:

```json
"devtui": "devtui"
```

do not run that as a child process.

### 4. Handle root aggregators carefully

This is the major tradeoff.

Root commands like `pnpm -r dev`, `yarn workspaces foreach run dev`, `bun --workspaces run dev`, `turbo run dev`, `nx run-many`, or `concurrently ...` already aggregate processes. Running them as one child is simple but weakens devtui.

Default strategy:

- If the root script is a recognizable aggregate, decompose to package tasks.
- If the root script is custom and high-risk, run the root script as one process unless `--prefer packages` is set.
- If the root script is `vp dev` with project-specific orchestration, treat it as high-risk until Vite Plus metadata detection exists.

### 5. Prefer package-local dev commands over `vp run target#dev`

This is important when an API must run directly so Infisical env reaches the package-local dev command.

For these packages, prefer:

```sh
bun run --cwd apps/api dev -- <apiPort> <inspectorPort>
```

over:

```sh
vp run api#dev
```

Vite Plus remains useful, but auto-discovery should not route through `vp run` when package-local `dev` scripts are discoverable and direct execution preserves env semantics.

### 6. Assign stable process names

Use package name first, path second:

- `apps/api` package name `api` → process `api`
- `apps/app` package name `app` → process `app`
- duplicate names get suffixes based on path

This keeps MCP process targeting stable.

## Infisical strategy

Infisical should become an Effect runtime integration, not only a string helper.

Current `withInfisical` is fine as an explicit-config helper, but auto mode needs a service that can:

1. Detect `.infisical.json`.
2. Determine default env/path/watch behavior.
3. Check CLI availability when necessary.
4. Wrap commands with `infisical run`.
5. Optionally export selected secrets for env-file bridges.
6. Avoid logging or serializing secret values.
7. Clean up temporary secret material with Scope finalizers.

Infisical’s CLI supports `infisical run -- <command>` for injecting secrets into an application process, and its `--watch` flag restarts the command when secrets change. `--project-config-dir` is explicitly useful for monorepos. ([Infisical Blog][2])

It also supports `infisical export`, including JSON output, env selection, and secret paths, which is the right primitive for controlled env-file bridging when a runtime cannot see inherited env directly. ([Infisical Blog][3])

### Default detection

Auto-enable Infisical when:

- `.infisical.json` exists at the project root
- not disabled by env/flag

Suggested flags/env:

```sh
devtui dev --infisical
devtui dev --no-infisical
devtui dev --infisical-env dev
devtui dev --infisical-path /
```

Also support env:

```sh
DEVTUI_INFISICAL=0
DEVTUI_INFISICAL_ENV=dev
DEVTUI_INFISICAL_PATHS=/,/runtime
DEVTUI_INFISICAL_WATCH=0
```

### Failure behavior

Use two modes:

- `auto`: if `.infisical.json` exists but the CLI is missing, show a diagnostic and either continue without secrets or fail depending on a policy flag.
- `required`: if user passed `--infisical`, fail clearly when CLI/auth/config is missing.

Do not silently swallow Infisical failures once the user explicitly requested it.

### Secret safety

Current runner logs:

```txt
starting: <command>
```

That is okay for `infisical run` wrappers because the command does not include secret values. But as soon as devtui supports exported env and env files, add a `displayCommand` separate from the actual command.

Never include secret env values in:

- system logs
- `ProcessRuntime`
- instance registry heartbeat files
- MCP status
- dry-run plan
- config snapshots

---

## Portless strategy

Portless should be modeled as **endpoint/URL integration**, not merely command wrapping.

The current helper `withPortless` wraps one command with `portless run` and adds env. That is a good explicit-config bridge. The configless design should go further and expose resulting URLs/ports to the TUI and MCP.

Portless already has a “zero-arg” mode that runs a package’s `dev` script and, from a monorepo root, starts workspace packages with the target script. It also has `portless run`, project-name inference, `--name`, and `--app-port`. ([portless][4]) Portless assigns app ports, sets `PORT`/usually `HOST`, and can inject `--port` flags for frameworks like Vite that do not simply respect `PORT`. ([portless][5])

That makes it tempting to implement:

```sh
devtui portless dev
```

as one child process running `portless`.

Do not do that as the default.

It would throw away devtui’s per-process lifecycle, log querying, restart controls, MCP process tools, and future endpoint metadata. Instead:

- devtui discovers tasks
- devtui decides which tasks are web apps
- devtui wraps only those tasks with Portless
- devtui records endpoint metadata

### Enablement rules

Enable Portless when:

- user passes `--portless`
- command alias is `devtui portless dev`
- `portless.json` exists
- eventually, explicit config/task metadata asks for it

Do not enable merely because `portless` is in `devDependencies`; that should mean “available,” not “active.”

### Process selection

Wrap app/web tasks, not every process.

Likely web task signals:

- package name/path: `app`, `web`, `frontend`, `docs`
- script uses Vite, Next, Astro, TanStack Start, React Router, etc.
- task has `providesHttp`
- task has allocated app port

Do not wrap API workers by default unless they need a stable browser URL.

### Metadata to add

Add endpoint metadata to process status:

```ts
ProcessRuntime {
  ...
  endpoints?: Endpoint[]
}

Endpoint {
  label
  url
  port?
  source: "detected" | "portless" | "log" | "config"
}
```

Then expose it through:

- TUI process rail/status panel
- `devtui_status`
- broker status
- future agent tools

This aligns with the repo spec note that Portless should eventually provide URL/port metadata to TUI and MCP status tools, not disappear inside command strings.

---

## Fallback and escape-hatch behavior

### Explicit config

Keep:

```ts
defineConfig({ processes });
```

as the stable core API.

Existing helpers should continue to work:

```ts
withEnv(...)
withInfisical(...)
withPortless(...)
vitePlusRun(...)
vitePlusDev(...)
```

`devtui.config.ts` should be documented as:

> Use this when auto-detection is wrong, when you need project-specific orchestration, or when you want to pin exact commands.

Not as the normal setup step.

### CLI overrides

Most users should not need config for simple changes:

```sh
devtui dev --include app
devtui dev --exclude worker
devtui dev --script start
devtui dev --manager pnpm
devtui dev --no-infisical
devtui dev --portless
```

### Plan export, not plan generation

Avoid making `devtui init` central. It reintroduces a config-first mindset.

A useful escape hatch is:

```sh
devtui dev --print-config
```

This can print the auto-generated explicit config for users who want to copy it. But the happy path should never write `devtui.config.ts`.

### No-task fallback

If no config and no dev scripts are found:

```txt
No dev tasks detected.

Looked for:
- package.json scripts.dev
- workspace packages
- supported root dev scripts

Try:
  devtui dev --script start
  devtui dev --demo
  devtui dev --config ./devtui.config.ts
```

Do not run the noisy demo unless `--demo` is explicit.

---

## Runtime architecture tradeoffs

### Fan out tasks instead of delegating to package-manager recursion

Package managers already know how to run scripts across workspaces, but delegating to one recursive command makes devtui less useful.

Preferred:

```txt
Process api  -> bun run dev in apps/api
Process app  -> bun run dev in apps/app
Process docs -> bun run dev in apps/docs
```

Fallback:

```txt
Process dev -> pnpm -r dev
```

Use fallback when the root aggregator is too custom to safely decompose.

### Keep `ProcessSpec` stable, but prepare for `CommandPlan`

Current `ProcessSpec.command` string is enough for v1. It lets auto-discovery work without rewriting the runner.

But nested wrappers like:

```sh
infisical run -- portless run -- env FOO=bar vp dev ...
```

will get fragile.

Path forward:

1. Auto-discovery emits a rich `DevPlan`.
2. v1 lowers to `ProcessSpec.command`.
3. Runner later accepts internal launch plans with argv/env/finalizers.
4. Public explicit config remains string-based for simplicity.

### Do not put discovery in the renderer

The current `App.tsx` should remain a renderer/subscriber/dispatcher. Discovery belongs before `makeProcessRunner`, next to config loading.

### Do not make Infisical/Portless React concerns

Both need Effect services because they touch child processes, env, temp files, ports, cleanup, and future MCP metadata.

### Be conservative with project-specific magic

devtui core should not become a pile of hard-coded app names. A good compromise:

- generic detectors for package scripts, workspaces, Vite/Vite Plus, Wrangler, Portless, Infisical
- convention adapters for common env names
- explicit config remains the final override

---

## Tests needed

### 1. Config resolution tests

Cover:

- `--demo` returns demo.
- `--config ./x.ts` loads explicit config.
- local `devtui.config.ts` wins over auto-detection.
- `--ignore-config` forces auto-detection.
- no config + detectable dev scripts returns detected config.
- no config + no dev scripts fails with a typed “no tasks detected” error.
- malformed explicit config still returns existing validation errors.
- demo is never the implicit fallback in a real project.

### 2. Package manager detection tests

Fixtures for:

- Bun via `packageManager: "bun@..."`
- Bun via `bun.lock`
- pnpm via `packageManager` and `pnpm-lock.yaml`
- pnpm via `pnpm-workspace.yaml`
- Yarn via `packageManager` and `yarn.lock`
- npm via `package-lock.json`
- conflicting signals where `packageManager` wins
- missing package manager binary
- override with `--manager`

### 3. Workspace enumeration tests

Cover:

- `workspaces: ["apps/*", "packages/*"]`
- `workspaces: { packages: [...] }`
- pnpm workspace globs
- nested packages
- ignored `node_modules`
- duplicate package names
- workspace package with missing/invalid `package.json`
- deterministic ordering

### 4. Dev task detection tests

Cover:

- single package with `scripts.dev`
- monorepo with two apps and multiple libraries
- packages without `dev` are skipped
- root `dev` script included in single-package repo
- root `dev` script skipped when it calls `devtui`
- root aggregate script decomposed when safe
- root custom script delegated when unsafe
- `--include`
- `--exclude`
- `--script start`
- duplicate process-name disambiguation

### 5. Command generation tests

For each package manager:

- generated command for package-local `dev`
- generated command with extra args
- generated command with cwd
- path containing spaces
- package name containing scope
- shell display command is stable
- no secret env values appear in display command

Keep existing `presets.test.ts` and extend it rather than replacing it.

### 6. App/API regression tests

Use a representative app/API fixture as a first-class regression suite.

Assert that configless detection produces:

- two processes: `api`, `app`
- API uses direct package dev command, not `vp run api#dev`
- API receives API port and inspector port
- app receives app port
- app receives API base URL
- Infisical wraps both processes when enabled
- `DEVTUI_INFISICAL=0` disables it
- Portless wraps app only when enabled
- no secret values are serialized into plan diagnostics, registry entries, or MCP status

### 7. Infisical tests

Use fake CLI layers; do not shell out to real Infisical in unit tests.

Cover:

- `.infisical.json` detection
- default env/path/watch
- env/flag overrides
- disabled mode
- required mode missing CLI fails
- auto mode missing CLI produces diagnostic
- `infisical run` command shape
- `--project-config-dir` points to root
- `infisical export --format=json` parsing for both object and array-of-key-value shapes
- temp env-file permissions and cleanup
- secret redaction

### 8. Portless tests

Use fake CLI/metadata layers.

Cover:

- `--portless` enables
- `devtui portless dev` aliases to `devtui dev --portless`
- `--no-portless` disables even if `portless.json` exists
- `portless.json` auto-enables
- dependency presence alone does not auto-enable
- app tasks are wrapped
- API/worker tasks are not wrapped by default
- app port is passed or discovered
- `PORTLESS_PORT`, `PORTLESS_HTTPS`, `PORTLESS_SYNC_HOSTS`, `PORTLESS_STATE_DIR` env behavior
- endpoint metadata appears in runner snapshot and MCP status

### 9. Port allocation tests

Cover:

- explicit env port wins
- dynamic port allocation when no env is set
- reserved ports are not reused
- collision retries
- strict-port capable tasks receive strict flags
- allocated ports are stable within one plan
- finalizers release reservations
- deterministic fake allocator for tests

### 10. Runner integration tests

Current runner tests should expand to prove auto-generated specs behave like explicit specs:

- start all auto-detected processes
- capture stdout/stderr
- restart one generated process
- stop one generated process
- clear logs
- process IDs remain stable
- generated cwd/env are honored
- system logs show sanitized startup lines
- integration finalizers run on stop

Ideally use a fake child-process layer where possible. Real-process tests can be minimal smoke tests.

### 11. MCP and registry tests

Cover:

- `devtui-mcp` uses same auto resolver as TUI
- configless instance registers title/cwd/processes
- broker lists configless instances
- broker controls generated processes by name
- JSONL-backed configless logs are queryable when enabled
- memory-backed logs report the current “unavailable to broker” message until IPC lands
- future endpoint metadata is visible in `devtui_status`

### 12. Snapshot tests for `--print-plan`

Plan snapshots are critical for magic.

Have fixtures for:

- single Bun app
- Bun monorepo
- pnpm monorepo
- Yarn monorepo
- npm workspace repo
- app/API workspace
- Infisical enabled
- Portless enabled
- ambiguous root aggregator

These tests make heuristic changes reviewable.

---

## Staged path forward

### Phase 1: Auto config resolver

Add `ResolvedDevtuiConfig` and project/workspace discovery. Change no runner behavior. Auto-detected plans lower to current `DevtuiConfig`.

Ship:

```sh
devtui dev --print-plan
devtui dev --ignore-config
```

Stop implicit demo fallback.

### Phase 2: Generic workspace dev

Support Bun, pnpm, Yarn, npm monorepos. Select packages with `scripts.dev`. Skip recursive `devtui` scripts. Prefer per-package processes.

### Phase 3: Infisical auto integration

Detect `.infisical.json`, wrap selected processes, support overrides, and preserve direct API command execution when required.

### Phase 4: Ports and endpoint metadata

Add a port allocator and endpoint metadata to process runtime/MCP status. This unlocks app/API env wiring without hard-coded configs.

### Phase 5: Portless integration

Add `--portless` and `devtui portless dev` alias. Wrap app tasks only. Expose Portless URLs in TUI/MCP.

### Phase 6: Rich launch plans

Internally move from shell-string composition to argv/env/finalizer launch plans. Keep explicit `defineConfig({ processes })` stable.

---

## Bottom line

The right design is not “remove config support.” It is:

> `devtui.config.ts` becomes an escape hatch; auto-discovered Effect runtime plans become the default.

For the happy path, `devtui dev` should discover the workspace, select dev-capable packages, run them as independent Effect-managed processes, apply Infisical and Portless as services/layers, and expose the resulting process/log/URL state through the same TUI and MCP architecture already present in the repo.

[1]: https://bun.com/docs/pm/workspaces "Workspaces - Bun"
[2]: https://infisical.com/docs/cli/commands/run "infisical run - Infisical"
[3]: https://infisical.com/docs/cli/commands/export "infisical export - Infisical"
[4]: https://portless.sh/commands "Commands | portless"
[5]: https://portless.sh/configuration "Configuration | portless"
