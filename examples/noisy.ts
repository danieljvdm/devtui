const args = process.argv.slice(2);
const name = args[0] ?? "process";
const numberArg = (flag: string, fallback: number) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const delay = numberArg("--delay", 750);
const failEvery = numberArg("--fail-every", 0);
let tick = 0;

console.log(`${name}: booting with pid ${process.pid}`);

setInterval(() => {
  tick += 1;
  const route = ["/", "/api/users", "/api/tasks", "/assets/app.js"][tick % 4];
  if (failEvery > 0 && tick % failEvery === 0) {
    console.error(`${name}: ERROR retryable failure while handling ${route}`);
    return;
  }
  console.log(`${name}: handled ${route} in ${20 + (tick % 9) * 7}ms`);
}, delay);
