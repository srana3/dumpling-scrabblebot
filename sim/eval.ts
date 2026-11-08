// Lineup construction + evaluation (single-threaded core; run.ts parallelizes).
import { makeChampion, DEFAULT_PARAMS, type Params } from "../bot/strategy.js";
import { ZOO, HOLDOUT } from "../opponents/zoo.js";
import type { AuctionType, BotFactory } from "../engine/types.js";
import { runMatch, SIM_POOL, mulberry32, type SeatSpec } from "./match.js";

export interface EvalJob {
  hero: string; // "champion" or zoo name
  heroParams?: Partial<Params>;
  lineup: string; // sims | starter | mixed | holdout | h2h:<name> | field:<a,b,c,d,e>
  rivalParams?: Partial<Params>; // for h2h:champion (self-play variants)
  from: number;
  to: number;
  seed: number;
  players: number;
  rack: number;
  type: AuctionType;
}
export interface HeroRow { place: number; score: number; win: number; rivalBeat: number; rivalScore: number; others: Record<string, number>; maxMs: number; errors: number }

function factory(name: string, params?: Partial<Params>): BotFactory {
  if (name === "champion") return makeChampion({ ...DEFAULT_PARAMS, ...params }, "champion");
  if (name === "champion2") return makeChampion({ ...DEFAULT_PARAMS, ...params }, "champion2");
  const f = ZOO[name];
  if (!f) throw new Error(`unknown bot ${name}`);
  return f;
}

function simSeats(rng: () => number, k: number): SeatSpec[] {
  const pool = SIM_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  const out: SeatSpec[] = [];
  for (let i = 0; i < k; i++) { const s = pool[i % pool.length]!; out.push({ kind: "sim", strategy: s.strategy, name: s.name }); }
  return out;
}

const TUNE_ZOO = Object.keys(ZOO).filter((k) => !HOLDOUT.includes(k));

export function runJob(j: EvalJob): HeroRow[] {
  const hero = factory(j.hero, j.heroParams);
  const rows: HeroRow[] = [];
  for (let m = j.from; m < j.to; m++) {
    const seed = (j.seed * 1000003 + m * 7919) | 0;
    const rng = mulberry32(seed ^ 0x1234567);
    const k = j.players - 1;
    let others: SeatSpec[];
    let rivalName: string | undefined;
    if (j.lineup === "sims") others = simSeats(rng, k);
    else if (j.lineup === "starter") others = Array.from({ length: k }, () => ({ kind: "bot", factory: ZOO.starter! }) as SeatSpec);
    else if (j.lineup === "mixed" || j.lineup === "holdout") {
      const pool = j.lineup === "mixed" ? TUNE_ZOO : HOLDOUT;
      const sims = simSeats(rng, k);
      others = Array.from({ length: k }, (_, i) =>
        rng() < 0.6 ? ({ kind: "bot", factory: ZOO[pool[Math.floor(rng() * pool.length)]!]! } as SeatSpec) : sims[i]!);
    } else if (j.lineup.startsWith("h2h:")) {
      rivalName = j.lineup.slice(4);
      others = [{ kind: "bot", factory: factory(rivalName, j.rivalParams) }, ...simSeats(rng, k - 1)];
    } else if (j.lineup.startsWith("field:")) {
      const names = j.lineup.slice(6).split(",");
      others = Array.from({ length: k }, (_, i) => {
        const nm = names[i % names.length]!;
        const sp = SIM_POOL.find((s) => s.name === nm);
        return sp ? ({ kind: "sim", strategy: sp.strategy, name: sp.name } as SeatSpec) : ({ kind: "bot", factory: factory(nm, j.rivalParams) } as SeatSpec);
      });
      rivalName = names[0];
    } else throw new Error(`unknown lineup ${j.lineup}`);
    // seat rotation: hero sits at seat m % players
    const heroSeat = m % j.players;
    const seats: SeatSpec[] = [...others];
    seats.splice(heroSeat, 0, { kind: "bot", factory: hero });
    const res = runMatch({ seed, seats, auctionType: j.type, rackSize: j.rack, timing: true });
    const h = res.seats[heroSeat]!;
    const rivalIdx = rivalName ? (heroSeat === 0 ? 1 : 0) : -1;
    const rival = rivalIdx >= 0 ? res.seats[rivalIdx]! : undefined;
    const othersAgg: Record<string, number> = {};
    res.seats.forEach((s, i) => { if (i !== heroSeat) othersAgg[s.name] = Math.max(othersAgg[s.name] ?? -1, s.score); });
    rows.push({
      place: h.place, score: h.score, win: h.place === 1 ? 1 : 0,
      rivalBeat: rival ? (h.score > rival.score ? 1 : h.score === rival.score ? 0.5 : 0) : NaN,
      rivalScore: rival ? rival.score : NaN, others: othersAgg, maxMs: h.maxDecisionMs, errors: h.bidErrors,
    });
  }
  return rows;
}

export function summarize(rows: HeroRow[]) {
  const n = rows.length;
  const mean = (f: (r: HeroRow) => number) => rows.reduce((a, r) => a + f(r), 0) / n;
  const sd = (f: (r: HeroRow) => number, m: number) => Math.sqrt(rows.reduce((a, r) => a + (f(r) - m) ** 2, 0) / Math.max(1, n - 1));
  const mp = mean((r) => r.place), ms = mean((r) => r.score), mw = mean((r) => r.win);
  const ci = (f: (r: HeroRow) => number, m: number) => (1.96 * sd(f, m)) / Math.sqrt(n);
  const others: Record<string, number> = {};
  const cnt: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.others)) { others[k] = (others[k] ?? 0) + v; cnt[k] = (cnt[k] ?? 0) + 1; }
  for (const k of Object.keys(others)) others[k] = Math.round((others[k]! / cnt[k]!) * 10) / 10;
  const rb = rows.filter((r) => !Number.isNaN(r.rivalBeat));
  return {
    n, place: +mp.toFixed(3), placeCI: +ci((r) => r.place, mp).toFixed(3), win: +mw.toFixed(3),
    score: +ms.toFixed(1), scoreCI: +ci((r) => r.score, ms).toFixed(1),
    h2h: rb.length ? +(rb.reduce((a, r) => a + r.rivalBeat, 0) / rb.length).toFixed(3) : undefined,
    rivalScore: rb.length ? +(rb.reduce((a, r) => a + r.rivalScore, 0) / rb.length).toFixed(1) : undefined,
    maxMs: +Math.max(...rows.map((r) => r.maxMs)).toFixed(1), errors: rows.reduce((a, r) => a + r.errors, 0), others,
  };
}
