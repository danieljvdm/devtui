const args = process.argv.slice(2);

const argValue = (flag: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const name = argValue("--name") ?? args[0] ?? "server";
const portValue = argValue("--port") ?? process.env.PORT ?? "5173";
const delayValue = argValue("--delay") ?? "0";
const failEveryValue = argValue("--fail-every") ?? "0";
const port = Number(portValue);
const delay = Number(delayValue);
const failEvery = Number(failEveryValue);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  console.error(`${name}: invalid port ${portValue}`);
  process.exit(1);
}

let requestCount = 0;

console.log(`${name}: starting on http://localhost:${port} with pid ${process.pid}`);

const server = Bun.serve({
  port,
  async fetch(request) {
    requestCount += 1;
    const url = new URL(request.url);

    if (Number.isFinite(delay) && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (Number.isFinite(failEvery) && failEvery > 0 && requestCount % failEvery === 0) {
      console.error(`${name}: ERROR simulated failure for ${url.pathname}`);
      return Response.json({ ok: false, name, path: url.pathname }, { status: 503 });
    }

    console.log(`${name}: ${request.method} ${url.pathname} #${requestCount}`);
    return Response.json({
      ok: true,
      name,
      path: url.pathname,
      requestCount,
      pid: process.pid,
    });
  },
});

const shutdown = () => {
  console.log(`${name}: shutting down`);
  server.stop(true);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
