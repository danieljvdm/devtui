# devtui agent guidance

## Architecture

`devtui` is an Effect-first Bun CLI. React/OpenTUI is only the rendering layer.

Core process-runner behavior belongs outside React:

- process spawning, lifecycle, log ingestion, buffering, querying, and future MCP/Portless/env-injector integration must live in Effect services
- log ingestion, retention, and querying must go through the `LogStore` service; add storage strategies as layers such as `LogStore.layerMemory`, `LogStore.layerJsonl`, and `LogStore.layerSqlite`
- UI components may render snapshots and dispatch typed commands, but must not own runtime state or child-process orchestration
- shared state that the UI observes should be exposed through Effect primitives such as `SubscriptionRef`, `Queue`, `PubSub`, streams, or Effect Atom
- prefer Effect Atom for UI state; avoid growing React hook state as the source of truth

## Smells

Treat these as architecture smells in production code:

- `Promise` as an application abstraction instead of `Effect`
- `async` / `await` outside tiny third-party API boundaries wrapped by `Effect`
- untyped `Error` instead of `Schema.TaggedErrorClass` / tagged domain errors
- direct `node:` or `Bun.*` imports in core code instead of `@effect/platform-bun` / Effect platform services
- React hooks performing runtime work instead of rendering/subscribing/dispatching

Boundaries may wrap third-party promise APIs with `Effect.tryPromise`, but the promise must not leak into domain APIs.

## Direction

Keep the runtime ready for:

- an MCP server that exposes process/log state to agents
- Portless integration for process URL and port discovery
- env var injectors such as Infisical
- richer log querying, filtering, and retention backends

If a change makes any of those harder, stop and reshape it before continuing.
