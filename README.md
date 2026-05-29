# Vite+ Effect CF Template

Reusable Vite+ monorepo template for Effect and `effect-cf` projects using Bun workspaces.

## Workspaces

- `apps/app` - browser app
- `apps/api` - Cloudflare-style API worker
- `packages/config` - shared TypeScript configuration

## Commands

- `bun install` - install dependencies, sync the Effect submodule, configure Vite+, and patch `effect-tsgo`
- `bun run check` - run each package's local patched `tsgo` check
- `bun run build` - build all packages that define a build script
- `bun run dev` - start the app dev server

## After Creating A Project

Rename the root package and workspace package scopes to match the new project.
