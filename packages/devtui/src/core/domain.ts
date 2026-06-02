import { Schema as S } from "effect";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import type { Fiber } from "effect/Fiber";

export interface ProcessSpec {
  readonly name: string;
  readonly command: string;
  readonly cleanupCommand?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly endpoints?: readonly Endpoint[];
}

export interface DevtuiConfig {
  readonly title?: string;
  readonly logs?: LogStoreConfig;
  readonly processes: readonly ProcessSpec[];
}

export const defineConfig = (config: DevtuiConfig): DevtuiConfig => config;

export type ResolvedConfigSource = "explicit" | "detected" | "demo";

export interface PlanDiagnostic {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface DevPlanProcess {
  readonly name: string;
  readonly packageName: string;
  readonly packagePath: string;
  readonly script: string;
  readonly command: string;
  readonly kind: "app" | "api" | "worker" | "library" | "unknown";
  readonly endpoints: readonly Endpoint[];
  readonly reasons: readonly string[];
}

export interface DevPlanIntegration {
  readonly name: "infisical" | "portless";
  readonly enabled: boolean;
  readonly reason: string;
}

export interface DevPlan {
  readonly root: string;
  readonly packageManager: string;
  readonly workspaceGlobs: readonly string[];
  readonly processes: readonly DevPlanProcess[];
  readonly integrations: readonly DevPlanIntegration[];
}

export interface Endpoint {
  readonly label: string;
  readonly url: string;
  readonly port?: number;
  readonly source: "detected" | "portless" | "log" | "config";
}

const localhostHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

const endpointIsLocal = (endpoint: Endpoint) => {
  try {
    const url = new URL(endpoint.url);
    return localhostHosts.has(url.hostname.toLowerCase());
  } catch {
    return endpoint.url.includes("localhost") || endpoint.url.includes("127.0.0.1");
  }
};

const endpointRank = (endpoint: Endpoint) => {
  if (endpoint.source === "portless") return 0;
  if (!endpointIsLocal(endpoint)) return 1;
  if (endpoint.source === "config") return 2;
  if (endpoint.source === "log") return 3;
  return 4;
};

/**
 * Choose the URL most useful to copy from a process row. Portless URLs win
 * because they are externally useful, then non-local URLs, then local endpoints.
 */
export const bestProcessEndpoint = (process: ProcessRuntime): Endpoint | null =>
  process.endpoints.reduce<Endpoint | null>((best, endpoint) => {
    if (best === null) return endpoint;
    return endpointRank(endpoint) < endpointRank(best) ? endpoint : best;
  }, null);

export interface ResolvedDevtuiConfig {
  readonly config: DevtuiConfig;
  readonly source: ResolvedConfigSource;
  readonly root: string;
  readonly diagnostics: readonly PlanDiagnostic[];
  readonly plan?: DevPlan;
}

export type LogStoreBackend = "memory" | "jsonl" | "sqlite";

export interface LogStoreConfig {
  readonly storage?: LogStoreBackend;
  readonly maxEntries?: number;
  readonly path?: string;
}

export type ProcessStatus = "starting" | "running" | "exited" | "failed" | "stopped";
export type LogStream = "stdout" | "stderr" | "system";
export type LogSeverity = "info" | "warn" | "error" | "system";

export interface ProcessRuntime {
  readonly id: string;
  readonly spec: ProcessSpec;
  readonly status: ProcessStatus;
  readonly endpoints: readonly Endpoint[];
  readonly pid: number | null;
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly exitCode: number | null;
  readonly lineCount: number;
  readonly errorCount: number;
}

export interface LogEntry {
  readonly id: number;
  readonly processId: string;
  readonly processName: string;
  readonly stream: LogStream;
  readonly severity: LogSeverity;
  readonly text: string;
  readonly ansiText?: string;
  readonly timestampMs: number;
}

export interface RunnerSnapshot {
  readonly processes: readonly ProcessRuntime[];
  readonly logs: readonly LogEntry[];
}

export interface RunningProcess {
  readonly runId: number;
  readonly fiber: Fiber<void, LogStoreError>;
  readonly handle: ChildProcessHandle | null;
}

export class ConfigLoadError extends S.TaggedErrorClass<ConfigLoadError>()("ConfigLoadError", {
  path: S.String,
  reason: S.String,
}) {
  override get message() {
    return `Could not load ${this.path}: ${this.reason}`;
  }
}

export class ConfigValidationError extends S.TaggedErrorClass<ConfigValidationError>()(
  "ConfigValidationError",
  {
    reason: S.String,
  },
) {
  override get message() {
    return this.reason;
  }
}

export class DiscoveryError extends S.TaggedErrorClass<DiscoveryError>()("DiscoveryError", {
  operation: S.String,
  reason: S.String,
}) {
  override get message() {
    return `Project discovery ${this.operation} failed: ${this.reason}`;
  }
}

export class NoDevTasksDetectedError extends S.TaggedErrorClass<NoDevTasksDetectedError>()(
  "NoDevTasksDetectedError",
  {
    root: S.String,
    script: S.String,
  },
) {
  override get message() {
    return [
      "No dev tasks detected.",
      "",
      `root: ${this.root}`,
      `script: ${this.script}`,
      "",
      "Looked for:",
      "- package.json scripts.dev",
      "- workspace packages",
      "- supported root dev scripts",
      "",
      "Try:",
      "  devtui dev --script start",
      "  devtui dev --demo",
      "  devtui dev --config ./devtui.config.ts",
    ].join("\n");
  }
}

export class RendererError extends S.TaggedErrorClass<RendererError>()("RendererError", {
  reason: S.String,
}) {
  override get message() {
    return `Could not start OpenTUI renderer: ${this.reason}`;
  }
}

export class LogStoreError extends S.TaggedErrorClass<LogStoreError>()("LogStoreError", {
  operation: S.String,
  reason: S.String,
}) {
  override get message() {
    return `Log store ${this.operation} failed: ${this.reason}`;
  }
}

export class InstanceRegistryError extends S.TaggedErrorClass<InstanceRegistryError>()(
  "InstanceRegistryError",
  {
    operation: S.String,
    reason: S.String,
  },
) {
  override get message() {
    return `Instance registry ${this.operation} failed: ${this.reason}`;
  }
}
