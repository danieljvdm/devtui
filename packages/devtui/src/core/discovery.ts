import { Context, Effect, FileSystem, Layer, Path } from "effect";
import {
  DiscoveryError,
  NoDevTasksDetectedError,
  type DevPlan,
  type DevPlanIntegration,
  type DevPlanProcess,
  type Endpoint,
  type LogStoreBackend,
  type PlanDiagnostic,
  type ProcessSpec,
} from "./domain.ts";
import { InfisicalIntegration } from "./infisical.ts";
import { PortAllocator } from "./port-allocator.ts";
import { PortlessIntegration, type PortlessEnvOptions } from "./portless.ts";

export type PackageManagerName = "bun" | "pnpm" | "yarn" | "npm";

export interface DiscoveryOptions {
  readonly script: string;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly manager: PackageManagerName | "auto";
  readonly infisical: "auto" | "enabled" | "disabled";
  readonly infisicalEnv: string;
  readonly infisicalPaths: readonly string[];
  readonly infisicalWatch: boolean;
  readonly portless: "auto" | "enabled" | "disabled";
  readonly portlessEnv: PortlessEnvOptions;
  readonly logs: LogStoreBackend | undefined;
  readonly portOverrides: Readonly<Record<string, number>>;
}

export interface WorkspacePackage {
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
  readonly scripts: Readonly<Record<string, string>>;
}

export interface ProjectInfo {
  readonly root: string;
  readonly packageManager: PackageManagerName;
  readonly packageManagerReason: string;
  readonly workspaceGlobs: readonly string[];
  readonly packages: readonly WorkspacePackage[];
  readonly rootPackage: WorkspacePackage | null;
  readonly hasInfisicalConfig: boolean;
  readonly hasPortlessConfig: boolean;
}

export interface DiscoveryResult {
  readonly project: ProjectInfo;
  readonly plan: DevPlan;
  readonly config: {
    readonly title: string;
    readonly logs?: { readonly storage: LogStoreBackend };
    readonly processes: readonly ProcessSpec[];
  };
  readonly diagnostics: readonly PlanDiagnostic[];
}

export class ProjectDiscovery extends Context.Service<
  ProjectDiscovery,
  {
    readonly discover: (
      cwd: string,
      options: DiscoveryOptions,
    ) => Effect.Effect<DiscoveryResult, DiscoveryError | NoDevTasksDetectedError>;
  }
>()("devtui/ProjectDiscovery") {}

const defaultIgnoredDirectories = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".next",
  "dist",
  "build",
  ".cache",
]);
const packageManagers = new Set(["bun", "pnpm", "yarn", "npm"]);
const needsShellQuotes = /[\s"'`$\\|&;<>(){}\[\]*?!#~]/;

const shellQuote = (value: string) =>
  value.length === 0 || needsShellQuotes.test(value)
    ? `'${value.replaceAll("'", `'"'"'`)}'`
    : value;

const command = (parts: readonly string[]) => parts.map(shellQuote).join(" ");

const toReason = (cause: unknown) =>
  cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : String(cause);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
};

const readJson = (
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<Record<string, unknown> | null, DiscoveryError> =>
  fs.readFileString(filePath).pipe(
    Effect.map((text) => JSON.parse(text) as unknown),
    Effect.map((json) => (isRecord(json) ? json : null)),
    Effect.catchCause((cause) =>
      Effect.fail(
        new DiscoveryError({
          operation: "read package manifest",
          reason: `${filePath}: ${toReason(cause)}`,
        }),
      ),
    ),
  );

const exists = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));

const directoryExists = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.stat(filePath).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );

const readDirectory = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.readDirectory(filePath).pipe(Effect.orElseSucceed(() => [] as Array<string>));

const packageNameFromPath = (pathService: Path.Path, root: string, packagePath: string) => {
  const relative = pathService.relative(root, packagePath);
  return relative === "" ? pathService.basename(root) : pathService.basename(relative);
};

const parsePackageManager = (value: unknown): PackageManagerName | null => {
  if (typeof value !== "string") return null;
  const name = value.split("@")[0];
  return packageManagers.has(name) ? (name as PackageManagerName) : null;
};

const managerFromLockfile = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
): Effect.Effect<{ readonly name: PackageManagerName; readonly reason: string }> =>
  Effect.gen(function* () {
    if (yield* exists(fs, pathService.join(root, "bun.lock")))
      return { name: "bun", reason: "bun.lock" };
    if (yield* exists(fs, pathService.join(root, "bun.lockb")))
      return { name: "bun", reason: "bun.lockb" };
    if (yield* exists(fs, pathService.join(root, "pnpm-lock.yaml")))
      return { name: "pnpm", reason: "pnpm-lock.yaml" };
    if (yield* exists(fs, pathService.join(root, "pnpm-workspace.yaml")))
      return { name: "pnpm", reason: "pnpm-workspace.yaml" };
    if (yield* exists(fs, pathService.join(root, "yarn.lock")))
      return { name: "yarn", reason: "yarn.lock" };
    if (yield* exists(fs, pathService.join(root, "package-lock.json")))
      return { name: "npm", reason: "package-lock.json" };
    return { name: "bun", reason: "fallback" };
  });

const detectPackageManager = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
  rootManifest: Record<string, unknown> | null,
  override: PackageManagerName | "auto",
) =>
  Effect.gen(function* () {
    if (override !== "auto") return { name: override, reason: "--manager" };

    const packageManager = parsePackageManager(rootManifest?.packageManager);
    if (packageManager) return { name: packageManager, reason: "packageManager" };

    return yield* managerFromLockfile(fs, pathService, root);
  });

const workspaceGlobsFromPackageJson = (manifest: Record<string, unknown> | null) => {
  const workspaces = manifest?.workspaces;
  if (Array.isArray(workspaces))
    return workspaces.filter((value): value is string => typeof value === "string");
  if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.filter((value): value is string => typeof value === "string");
  }
  return [];
};

const workspaceGlobsFromPnpm = (fs: FileSystem.FileSystem, pathService: Path.Path, root: string) =>
  fs.readFileString(pathService.join(root, "pnpm-workspace.yaml")).pipe(
    Effect.map((text) => {
      const globs: string[] = [];
      let inPackages = false;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "packages:") {
          inPackages = true;
          continue;
        }
        if (inPackages && /^\w/.test(line)) break;
        const match = inPackages ? trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/) : null;
        if (match) globs.push(match[1]);
      }
      return globs;
    }),
    Effect.orElseSucceed(() => [] as string[]),
  );

const globPackages = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
  pattern: string,
): Effect.Effect<readonly string[]> => {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);

  const expand = (base: string, remaining: readonly string[]): Effect.Effect<readonly string[]> =>
    Effect.gen(function* () {
      if (remaining.length === 0) {
        return (yield* exists(fs, pathService.join(base, "package.json"))) ? [base] : [];
      }

      const [head, ...tail] = remaining;
      if (head === "*") {
        const entries = yield* readDirectory(fs, base);
        const expanded = yield* Effect.forEach(
          entries
            .filter((entry) => !entry.startsWith(".") && !defaultIgnoredDirectories.has(entry))
            .sort(),
          (entry) => {
            const next = pathService.join(base, entry);
            return directoryExists(fs, next).pipe(
              Effect.flatMap((isDirectory) =>
                isDirectory ? expand(next, tail) : Effect.succeed([] as readonly string[]),
              ),
            );
          },
        );
        return expanded.flat();
      }

      if (head === "**") {
        const direct = yield* expand(base, tail);
        const entries = yield* readDirectory(fs, base);
        const nested = yield* Effect.forEach(
          entries
            .filter((entry) => !entry.startsWith(".") && !defaultIgnoredDirectories.has(entry))
            .sort(),
          (entry) => {
            const next = pathService.join(base, entry);
            return directoryExists(fs, next).pipe(
              Effect.flatMap((isDirectory) =>
                isDirectory ? expand(next, remaining) : Effect.succeed([] as readonly string[]),
              ),
            );
          },
        );
        return [...direct, ...nested.flat()];
      }

      return yield* expand(pathService.join(base, head), tail);
    });

  return expand(root, parts);
};

const readPackage = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
  packagePath: string,
): Effect.Effect<WorkspacePackage | null, DiscoveryError> =>
  Effect.gen(function* () {
    const manifest = yield* readJson(fs, pathService.join(packagePath, "package.json"));
    if (!manifest) return null;

    return {
      name:
        typeof manifest.name === "string" && manifest.name.trim()
          ? manifest.name
          : packageNameFromPath(pathService, root, packagePath),
      path: packagePath,
      relativePath: pathService.relative(root, packagePath) || ".",
      scripts: stringRecord(manifest.scripts),
    };
  });

const rootScore = (fs: FileSystem.FileSystem, pathService: Path.Path, directory: string) =>
  Effect.gen(function* () {
    let score = 0;
    const manifest = (yield* exists(fs, pathService.join(directory, "package.json")))
      ? yield* readJson(fs, pathService.join(directory, "package.json"))
      : null;

    if (manifest) score += 2;
    if (parsePackageManager(manifest?.packageManager)) score += 3;
    if (workspaceGlobsFromPackageJson(manifest).length > 0) score += 6;
    if (yield* exists(fs, pathService.join(directory, "pnpm-workspace.yaml"))) score += 6;
    if (yield* exists(fs, pathService.join(directory, "bun.lock"))) score += 3;
    if (yield* exists(fs, pathService.join(directory, "bun.lockb"))) score += 3;
    if (yield* exists(fs, pathService.join(directory, "pnpm-lock.yaml"))) score += 3;
    if (yield* exists(fs, pathService.join(directory, "yarn.lock"))) score += 3;
    if (yield* exists(fs, pathService.join(directory, "package-lock.json"))) score += 3;
    if (yield* exists(fs, pathService.join(directory, ".git"))) score += 1;
    return score;
  });

const findProjectRoot = (fs: FileSystem.FileSystem, pathService: Path.Path, cwd: string) =>
  Effect.gen(function* () {
    const candidates: string[] = [];
    let current = pathService.resolve(cwd);
    while (true) {
      candidates.push(current);
      const parent = pathService.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    let best = pathService.resolve(cwd);
    let bestScore = -1;
    for (const [index, candidate] of candidates.entries()) {
      const score = yield* rootScore(fs, pathService, candidate);
      if (score > bestScore || (score === bestScore && index === 0)) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  });

const runScriptCommand = (manager: PackageManagerName, script: string) => {
  switch (manager) {
    case "bun":
      return command(["bun", "run", script]);
    case "pnpm":
      return command(["pnpm", "run", script]);
    case "yarn":
      return command(["yarn", script]);
    case "npm":
      return command(["npm", "run", script]);
  }
};

const normalizedPackageName = (name: string) => {
  const withoutScope = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return withoutScope.replace(/^@/, "") || "dev";
};

const classifyTask = (pkg: WorkspacePackage, commandText: string): DevPlanProcess["kind"] => {
  const haystack = `${pkg.name} ${pkg.relativePath} ${commandText}`.toLowerCase();
  if (/\b(api|server)\b/.test(haystack) || haystack.includes("wrangler")) return "api";
  if (/\b(worker|queue|job)\b/.test(haystack)) return "worker";
  if (
    /\b(app|web|frontend|docs)\b/.test(haystack) ||
    /\b(vite|next|astro|remix|react-router)\b/.test(haystack)
  )
    return "app";
  return "unknown";
};

const defaultPortForKind = (kind: DevPlanProcess["kind"]) => {
  switch (kind) {
    case "app":
      return 5173;
    case "api":
      return 8787;
    default:
      return null;
  }
};

const portOverrideFor = (
  options: DiscoveryOptions,
  process: { readonly name: string; readonly packageName: string; readonly packagePath: string },
) =>
  options.portOverrides[process.name] ??
  options.portOverrides[process.packageName] ??
  options.portOverrides[process.packagePath] ??
  options.portOverrides["*"];

const allocatePorts = (
  portAllocator: typeof PortAllocator.Service,
  options: DiscoveryOptions,
  processes: readonly {
    readonly name: string;
    readonly packageName: string;
    readonly packagePath: string;
    readonly kind: DevPlanProcess["kind"];
  }[],
) =>
  Effect.gen(function* () {
    const ports = new Map<string, number>();

    for (const process of processes) {
      const defaultPort = defaultPortForKind(process.kind);
      if (defaultPort === null) continue;
      const reservation = yield* portAllocator.reserve({
        label: process.name,
        preferred: portOverrideFor(options, process) ?? defaultPort,
      });
      ports.set(process.name, reservation.port);
    }

    return ports;
  });

const endpointFor = (
  process: Pick<DevPlanProcess, "name" | "kind">,
  port: number | undefined,
  source: Endpoint["source"],
): readonly Endpoint[] => {
  if (port === undefined || (process.kind !== "app" && process.kind !== "api")) return [];
  return [
    {
      label: process.kind === "api" ? "api" : "app",
      url: `http://localhost:${port}`,
      port,
      source,
    },
  ];
};

const isRecursiveDevtuiScript = (script: string) => /\bdevtui\b/.test(script);

const matchesAny = (pkg: WorkspacePackage, processName: string, values: readonly string[]) =>
  values.length === 0 ||
  values.some(
    (value) =>
      processName === value ||
      pkg.name === value ||
      pkg.relativePath === value ||
      pkg.relativePath.includes(value),
  );

const isExcluded = (pkg: WorkspacePackage, processName: string, values: readonly string[]) =>
  values.some(
    (value) =>
      processName === value ||
      pkg.name === value ||
      pkg.relativePath === value ||
      pkg.relativePath.includes(value),
  );

const uniqueNames = (packages: readonly WorkspacePackage[]) => {
  const baseCounts = new Map<string, number>();
  const names = new Map<string, string>();

  for (const pkg of packages) {
    const base = normalizedPackageName(pkg.name || pkg.relativePath);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  for (const pkg of packages) {
    const base = normalizedPackageName(pkg.name || pkg.relativePath);
    if ((baseCounts.get(base) ?? 0) === 1) {
      names.set(pkg.path, base);
      continue;
    }
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const suffix = pkg.relativePath
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    names.set(pkg.path, `${base}-${suffix || count}`);
  }

  return names;
};

const buildDevPlan = (
  project: ProjectInfo,
  options: DiscoveryOptions,
): Effect.Effect<
  DiscoveryResult,
  DiscoveryError | NoDevTasksDetectedError,
  InfisicalIntegration | PortAllocator | PortlessIntegration
> =>
  Effect.gen(function* () {
    const infisical = yield* InfisicalIntegration;
    const portAllocator = yield* PortAllocator;
    const portless = yield* PortlessIntegration;
    const workspaceTasks = project.packages.filter(
      (pkg) => pkg.scripts[options.script] && !isRecursiveDevtuiScript(pkg.scripts[options.script]),
    );
    const candidates =
      workspaceTasks.length > 0
        ? workspaceTasks
        : project.rootPackage &&
            project.rootPackage.scripts[options.script] &&
            !isRecursiveDevtuiScript(project.rootPackage.scripts[options.script])
          ? [project.rootPackage]
          : [];

    if (candidates.length === 0) {
      return yield* Effect.fail(
        new NoDevTasksDetectedError({ root: project.root, script: options.script }),
      );
    }

    const nameMap = uniqueNames(candidates);
    const selected = candidates.filter((pkg) => {
      const processName = nameMap.get(pkg.path) ?? normalizedPackageName(pkg.name);
      return (
        matchesAny(pkg, processName, options.includes) &&
        !isExcluded(pkg, processName, options.excludes)
      );
    });

    if (selected.length === 0) {
      return yield* Effect.fail(
        new NoDevTasksDetectedError({ root: project.root, script: options.script }),
      );
    }

    const portlessPlan = yield* portless.plan({
      mode: options.portless,
      hasConfig: project.hasPortlessConfig,
      env: options.portlessEnv,
    });
    const infisicalPlan = yield* infisical.plan({
      mode: options.infisical,
      hasConfig: project.hasInfisicalConfig,
      root: project.root,
      env: options.infisicalEnv,
      paths: options.infisicalPaths,
      watch: options.infisicalWatch,
    });

    const planProcessInputs = selected.map((pkg) => {
      const processName = nameMap.get(pkg.path) ?? normalizedPackageName(pkg.name);
      const commandText = runScriptCommand(project.packageManager, options.script);
      const kind = classifyTask(pkg, pkg.scripts[options.script] ?? commandText);
      return { pkg, processName, commandText, kind };
    });
    const ports = yield* allocatePorts(
      portAllocator,
      options,
      planProcessInputs.map((input) => ({
        name: input.processName,
        packageName: input.pkg.name,
        packagePath: input.pkg.relativePath,
        kind: input.kind,
      })),
    );

    const planProcesses = planProcessInputs.map(
      ({ pkg, processName, commandText, kind }): DevPlanProcess => {
        const endpoints = endpointFor(
          { name: processName, kind },
          ports.get(processName),
          portlessPlan.endpointSourceFor({ kind }),
        );
        return {
          name: processName,
          packageName: pkg.name,
          packagePath: pkg.relativePath,
          script: options.script,
          command: commandText,
          kind,
          endpoints,
          reasons: [`package has scripts.${options.script}`],
        };
      },
    );

    const integrations: DevPlanIntegration[] = [
      {
        name: "infisical",
        enabled: infisicalPlan.enabled,
        reason: infisicalPlan.reason,
      },
      {
        name: "portless",
        enabled: portlessPlan.enabled,
        reason: portlessPlan.reason,
      },
    ];

    const processSpecs = planProcesses.map((process): ProcessSpec => {
      const pkg = selected.find((candidate) => candidate.relativePath === process.packagePath);
      const initial = {
        name: process.name,
        command: process.command,
        cwd: pkg?.path,
        env:
          process.endpoints[0]?.port === undefined
            ? undefined
            : { PORT: String(process.endpoints[0].port) },
        endpoints: process.endpoints,
      };
      const withInfisical = infisicalPlan.wrap(initial);
      return portlessPlan.wrap(withInfisical, {
        name: process.name,
        kind: process.kind,
        appPort: process.endpoints[0]?.port,
      });
    });

    const diagnostics: PlanDiagnostic[] = [
      { level: "info", message: `root: ${project.root}` },
      {
        level: "info",
        message: `package manager: ${project.packageManager}, from ${project.packageManagerReason}`,
      },
      {
        level: "info",
        message: `selected processes: ${planProcesses.map((process) => process.name).join(", ")}`,
      },
      ...integrations.map((integration) => ({
        level: "info" as const,
        message: `${integration.name}: ${integration.enabled ? "enabled" : "disabled"}, ${integration.reason}`,
      })),
      ...infisicalPlan.diagnostics,
      ...portlessPlan.diagnostics,
    ];

    return {
      project,
      plan: {
        root: project.root,
        packageManager: project.packageManager,
        workspaceGlobs: project.workspaceGlobs,
        processes: planProcesses,
        integrations,
      },
      config: {
        title: `devtui ${project.packageManager} dev`,
        logs: options.logs === undefined ? undefined : { storage: options.logs },
        processes: processSpecs,
      },
      diagnostics,
    };
  });

const discoverProject = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  cwd: string,
  options: DiscoveryOptions,
) =>
  Effect.gen(function* () {
    const root = yield* findProjectRoot(fs, pathService, cwd);
    const rootManifest = (yield* exists(fs, pathService.join(root, "package.json")))
      ? yield* readJson(fs, pathService.join(root, "package.json"))
      : null;
    const rootPackage = yield* readPackage(fs, pathService, root, root);
    const packageManager = yield* detectPackageManager(
      fs,
      pathService,
      root,
      rootManifest,
      options.manager,
    );
    const packageJsonWorkspaceGlobs = workspaceGlobsFromPackageJson(rootManifest);
    const pnpmWorkspaceGlobs = yield* workspaceGlobsFromPnpm(fs, pathService, root);
    const workspaceGlobs =
      packageJsonWorkspaceGlobs.length > 0 ? packageJsonWorkspaceGlobs : pnpmWorkspaceGlobs;
    const packagePaths =
      workspaceGlobs.length > 0
        ? Array.from(
            new Set(
              (yield* Effect.forEach(workspaceGlobs, (glob) =>
                globPackages(fs, pathService, root, glob),
              )).flat(),
            ),
          )
        : rootPackage
          ? [root]
          : [];
    const packages = (yield* Effect.forEach(packagePaths, (packagePath) =>
      readPackage(fs, pathService, root, packagePath).pipe(
        Effect.catchTag("DiscoveryError", () => Effect.succeed(null)),
      ),
    ))
      .filter((pkg): pkg is WorkspacePackage => pkg !== null)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const project: ProjectInfo = {
      root,
      packageManager: packageManager.name,
      packageManagerReason: packageManager.reason,
      workspaceGlobs,
      packages: workspaceGlobs.length > 0 ? packages : rootPackage ? [rootPackage] : [],
      rootPackage,
      hasInfisicalConfig: yield* exists(fs, pathService.join(root, ".infisical.json")),
      hasPortlessConfig: yield* exists(fs, pathService.join(root, "portless.json")),
    };

    return yield* buildDevPlan(project, options);
  }).pipe(
    Effect.catchTags({
      DiscoveryError: (error) => Effect.fail(error),
      NoDevTasksDetectedError: (error) => Effect.fail(error),
    }),
    Effect.catchCause((cause) =>
      Effect.fail(
        new DiscoveryError({
          operation: "discover project",
          reason: toReason(cause),
        }),
      ),
    ),
  );

export const layer: Layer.Layer<
  ProjectDiscovery,
  never,
  FileSystem.FileSystem | Path.Path | InfisicalIntegration | PortAllocator | PortlessIntegration
> = Layer.effect(
  ProjectDiscovery,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const infisical = yield* InfisicalIntegration;
    const pathService = yield* Path.Path;
    const portAllocator = yield* PortAllocator;
    const portless = yield* PortlessIntegration;
    return {
      discover: (cwd, options) =>
        discoverProject(fs, pathService, cwd, options).pipe(
          Effect.provideService(InfisicalIntegration, infisical),
          Effect.provideService(PortAllocator, portAllocator),
          Effect.provideService(PortlessIntegration, portless),
        ),
    };
  }),
);

export const formatPlan = (plan: DevPlan, diagnostics: readonly PlanDiagnostic[] = []) => {
  const lines = [
    "devtui auto plan",
    `root: ${plan.root}`,
    `package manager: ${plan.packageManager}`,
    `workspaces: ${plan.workspaceGlobs.length > 0 ? plan.workspaceGlobs.join(", ") : "(single package)"}`,
    "selected processes:",
    ...plan.processes.map(
      (process) => `  ${process.name}  ${process.packagePath}  ${process.command}`,
    ),
    "ports:",
    ...plan.processes.flatMap((process) =>
      process.endpoints.length === 0
        ? []
        : process.endpoints.map(
            (endpoint) =>
              `  ${process.name} ${endpoint.label}: ${endpoint.port ?? "-"} ${endpoint.url}`,
          ),
    ),
    "integrations:",
    ...plan.integrations.map(
      (integration) =>
        `  ${integration.name}: ${integration.enabled ? "enabled" : "disabled"} (${integration.reason})`,
    ),
  ];
  const warningLines = diagnostics
    .filter((diagnostic) => diagnostic.level !== "info")
    .map((diagnostic) => `  ${diagnostic.level}: ${diagnostic.message}`);
  return warningLines.length === 0
    ? lines.join("\n")
    : [...lines, "diagnostics:", ...warningLines].join("\n");
};
