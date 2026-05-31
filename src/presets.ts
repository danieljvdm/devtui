import type { ProcessSpec } from "./core/domain.ts";

export interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface InfisicalOptions {
  readonly env?: string;
  readonly paths?: readonly string[];
  readonly projectConfigDir?: string;
  readonly watch?: boolean;
}

export interface PortlessOptions {
  readonly name?: string;
  readonly appPort?: number | string;
  readonly proxyPort?: number | string;
  readonly https?: boolean;
  readonly syncHosts?: boolean;
  readonly stateDir?: string;
  readonly tld?: string;
  readonly force?: boolean;
}

const needsShellQuotes = /[\s"'`$\\|&;<>(){}\[\]*?!#~]/;

const shellQuote = (value: string) =>
  value.length === 0 || needsShellQuotes.test(value)
    ? `'${value.replaceAll("'", `'"'"'`)}'`
    : value;

export const command = (parts: readonly string[]) => parts.map(shellQuote).join(" ");

export const process = (
  name: string,
  parts: readonly string[] | string,
  options: ProcessOptions = {},
): ProcessSpec => ({
  name,
  command: typeof parts === "string" ? parts : command(parts),
  cwd: options.cwd,
  env: options.env,
});

export const withEnv = (spec: ProcessSpec, env: Readonly<Record<string, string>>): ProcessSpec => ({
  ...spec,
  env: {
    ...spec.env,
    ...env,
  },
});

export const withInfisical = (spec: ProcessSpec, options: InfisicalOptions = {}): ProcessSpec => {
  const env = options.env ?? "dev";
  const paths = options.paths ?? ["/"];
  const args = [
    "infisical",
    "run",
    ...(options.projectConfigDir === undefined
      ? []
      : ["--project-config-dir", options.projectConfigDir]),
    "--env",
    env,
    ...paths.flatMap((path) => ["--path", path]),
    ...(options.watch === false ? [] : ["--watch"]),
    "--",
    spec.command,
  ];

  return {
    ...spec,
    command: args
      .map((part, index) => (index === args.length - 1 ? part : shellQuote(part)))
      .join(" "),
  };
};

export const withPortless = (spec: ProcessSpec, options: PortlessOptions = {}): ProcessSpec => {
  const portlessEnv = {
    ...(options.proxyPort === undefined ? {} : { PORTLESS_PORT: String(options.proxyPort) }),
    ...(options.https === undefined ? {} : { PORTLESS_HTTPS: options.https ? "1" : "0" }),
    ...(options.syncHosts === undefined
      ? {}
      : { PORTLESS_SYNC_HOSTS: options.syncHosts ? "1" : "0" }),
    ...(options.stateDir === undefined ? {} : { PORTLESS_STATE_DIR: options.stateDir }),
    ...(options.tld === undefined ? {} : { PORTLESS_TLD: options.tld }),
  };
  const env =
    spec.env === undefined && Object.keys(portlessEnv).length === 0
      ? undefined
      : { ...spec.env, ...portlessEnv };
  const args = [
    "portless",
    "run",
    ...(options.name === undefined ? [] : ["--name", options.name]),
    ...(options.appPort === undefined ? [] : ["--app-port", String(options.appPort)]),
    ...(options.force === true ? ["--force"] : []),
    spec.command,
  ];

  return {
    ...spec,
    command: args
      .map((part, index) => (index === args.length - 1 ? part : shellQuote(part)))
      .join(" "),
    env,
  };
};

export const vitePlusRun = (
  name: string,
  target: string,
  args: readonly string[] = [],
  options: ProcessOptions = {},
): ProcessSpec =>
  process(name, ["vp", "run", target, ...(args.length === 0 ? [] : ["--", ...args])], options);

export const vitePlusDev = (
  name = "vite",
  args: readonly string[] = [],
  options: ProcessOptions = {},
): ProcessSpec => process(name, ["vp", "dev", ...args], options);
