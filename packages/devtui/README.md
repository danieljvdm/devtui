# devtui

Run a project's development processes in one terminal UI.

## Quick Start

```sh
bun add -d devtui
```

Add a script:

```json
{
  "scripts": {
    "dev": "devtui dev"
  }
}
```

Run it:

```sh
bun run dev
```

`devtui dev` auto-detects workspace packages with dev-capable scripts and starts one process per package. Use `--print-plan` to preview what will run:

```sh
bunx devtui dev --print-plan
```

## Optional Config

Create `devtui.config.ts` when auto-detection is not enough:

```ts
import { defineConfig } from "devtui/config";

export default defineConfig({
  title: "my app",
  processes: [
    { name: "web", command: "bun run --cwd apps/web dev" },
    { name: "api", command: "bun run --cwd apps/api dev" },
  ],
});
```

Then run:

```sh
bunx devtui dev
```

Useful commands:

```sh
bunx devtui dev --config ./devtui.config.ts
bunx devtui dev --demo
bunx devtui dev --dry-run
```

## MCP

`devtui` also ships MCP servers for agents:

```sh
bunx --package devtui devtui-mcp
bunx --package devtui devtui-broker
```
