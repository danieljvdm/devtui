# devtui examples

These configs are small runnable fixtures for the common process shapes devtui should keep healthy.

Run them from the repository root:

```sh
bun run example:one
bun run example:multi
bun run example:portless
```

Or pass the config directly:

```sh
bun run packages/devtui/src/index.tsx dev --config packages/devtui/examples/vanilla-one.config.ts
bun run packages/devtui/src/index.tsx dev --config packages/devtui/examples/vanilla-multi.config.ts
bun run packages/devtui/src/index.tsx dev --config packages/devtui/examples/portless-multi.config.ts
```

## Fixtures

- `vanilla-one.config.ts` starts one HTTP process with endpoint metadata.
- `vanilla-multi.config.ts` starts web, api, and worker processes without integrations.
- `portless-multi.config.ts` wraps only the web process with Portless, while api and worker stay direct.
- `jsonl-demo.config.ts` writes logs to `.devtui/jsonl-demo.jsonl` for broker/log-store testing.
- `percorso.config.ts` is the Percorso-shaped migration sketch.
