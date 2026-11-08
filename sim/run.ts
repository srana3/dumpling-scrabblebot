// Parallel evaluation CLI.
//   npx tsx sim/run.ts --lineup sims --n 600 [--hero champion] [--params '{"kEarly":2}'] [--type FirstPrice] [--players 6] [--rack 5]
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { runJob, summarize, type EvalJob, type HeroRow } from "./eval.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

export async function evaluate(base: Omit<EvalJob, "from" | "to">, n: number, workers = Math.max(1, os.cpus().length - 1)): Promise<HeroRow[]> {
  const chunk = Math.ceil(n / workers);
  const file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const from = w * chunk, to = Math.min(n, from + chunk);
      if (from >= to) return Promise.resolve([] as HeroRow[]);
      return new Promise<HeroRow[]>((res, rej) => {
        const wk = new Worker(file, { workerData: { ...base, from, to }, execArgv: ["--import", "tsx"] });
        wk.once("message", res); wk.once("error", rej);
      });
    }),
  );
  return parts.flat();
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as EvalJob));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t0 = Date.now();
  const job: Omit<EvalJob, "from" | "to"> = {
    hero: arg("hero", "champion"),
    heroParams: JSON.parse(arg("params", "{}")),
    rivalParams: JSON.parse(arg("rparams", "{}")),
    lineup: arg("lineup", "sims"),
    seed: +arg("seed", "1"),
    players: +arg("players", "6"),
    rack: +arg("rack", "5"),
    type: arg("type", "Vickrey") as EvalJob["type"],
  };
  const n = +arg("n", "300");
  evaluate(job, n, +arg("workers", String(Math.max(1, os.cpus().length - 1)))).then((rows) => {
    console.log(JSON.stringify({ job: { ...job }, ...summarize(rows), secs: (Date.now() - t0) / 1000 }));
  });
}
