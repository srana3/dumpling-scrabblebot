// Compact random search + coordinate refinement over champion params (CRN: same seeds per config).
//   npx tsx sim/tune.ts --iters 30 --n 240 --fields "field:market,market,marketHi,market,market;field:market,marketHi,Brutus,Valor,starter"
import { evaluate } from "./run.js";
import { summarize } from "./eval.js";
import { DEFAULT_PARAMS, type Params } from "../bot/strategy.js";
import * as fs from "node:fs";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const ITERS = +arg("iters", "30");
const N = +arg("n", "240");
const FIELDS = arg("fields", "field:market,market,marketHi,market,market;field:market,marketHi,Brutus,Valor,starter").split(";");
const START: Partial<Params> = JSON.parse(arg("start", "{}"));
const RIVAL: Partial<Params> = JSON.parse(arg("rparams", "{}"));

const SPACE: Record<string, [number, number]> = {
  kEarly: [1.0, 3.2], tEarly: [0, 5], kRamp: [10, 45], mu: [0.8, 4], endMu: [1, 3], endRem: [2, 14],
  pace: [3, 20], minCap: [2, 20], playLen: [4, 8], kPlay: [0.5, 2.2], tPlay: [0, 2.5], cashLow: [0, 40], cashLen: [4, 6], qWin: [0.3, 1], inc: [0, 1.5], lamMax: [0.6, 3], prior: [2, 20],
};
const INT = new Set(["playLen", "cashLen", "endRem", "kRamp"]);

async function score(p: Partial<Params>) {
  let place = 0, sc = 0; const per: string[] = [];
  for (const lineup of FIELDS) {
    const rows = await evaluate({ hero: "champion", heroParams: p, lineup, rivalParams: RIVAL, seed: 11, players: 6, rack: 5, type: "Vickrey" }, N);
    const s = summarize(rows);
    place += s.place / FIELDS.length; sc += s.score / FIELDS.length; per.push(`${s.place.toFixed(2)}/${s.score}`);
  }
  return { obj: place - sc / 10000, place, sc, per };
}
function rnd(lo: number, hi: number, k: string) { const x = lo + Math.random() * (hi - lo); return INT.has(k) ? Math.round(x) : +x.toFixed(2); }

const t0 = Date.now();
let best: Partial<Params> = { ...DEFAULT_PARAMS, ...START };
let bestS = await score(best);
console.log("start", bestS.per.join(" "), JSON.stringify(best));
for (let it = 0; it < ITERS; it++) {
  const cand: Partial<Params> = { ...best };
  if (it < ITERS / 2) {
    // global: resample 3-5 coordinates
    const keys = Object.keys(SPACE).sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
    for (const k of keys) (cand as Record<string, number>)[k] = rnd(...SPACE[k]!, k);
  } else {
    // local: perturb 1-2 coordinates by ~15% of range
    const keys = Object.keys(SPACE).sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
    for (const k of keys) {
      const [lo, hi] = SPACE[k]!; const cur = (cand as Record<string, number>)[k] ?? lo;
      const x = Math.min(hi, Math.max(lo, cur + (Math.random() * 2 - 1) * 0.15 * (hi - lo)));
      (cand as Record<string, number>)[k] = INT.has(k) ? Math.round(x) : +x.toFixed(2);
    }
  }
  const s = await score(cand);
  const better = s.obj < bestS.obj;
  console.log(`${it} ${better ? "*" : " "} ${s.per.join(" ")}  place ${s.place.toFixed(3)} (best ${bestS.place.toFixed(3)}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (better) { best = cand; bestS = s; fs.writeFileSync("sim/best-params.json", JSON.stringify(best, null, 1)); }
}
console.log("BEST", bestS.per.join(" "), JSON.stringify(best));
