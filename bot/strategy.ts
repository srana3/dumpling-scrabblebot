// Champion strategy ("dumpling"). Pure functions of the public BotView; used verbatim by sim and live bot.
import { loadDict } from "../engine/dict.js";
import { VALUE, BAG_COUNTS, LETTERS, li, letterValue, type Counts } from "../engine/letters.js";
import { bestPartition } from "../engine/partition.js";
import type { BotFactory, BotInstance, BotView } from "../engine/types.js";

export interface Params {
  kEarly: number; // option value per face point of an unplayed tile, early game
  kEnd: number; // ... near the end
  kRamp: number; // auctions-remaining over which kappa ramps from kEnd to kEarly
  tEarly: number; // per-tile enabling value (any letter), early game; ramps to 0 with kappa
  kPlay: number; // mid-game: option value used when deciding which words to cash in now
  tPlay: number;
  mu: number; // money units bid per point of marginal value
  endMu: number; // multiplier in the last `endRem` auctions (money is worthless at the end)
  endRem: number;
  pace: number; // cap = balance * min(1, pace / remaining)
  minCap: number; // cap is never below this (if balance allows)
  playLen: number; // mid-game: play partition words at least this long
  cashLow: number; // below this balance, also play words >= cashLen
  cashLen: number;
  liqRem: number; // liquidate (play full partition) when bagTotal <= liqRem
  liqKappa: number;
  jitter: number; // relative bid randomization
  denial: number; // extra bid per face point (denial premium)
  adaptive: number; // 1 = shade bids with the market model (score-per-coin threshold); 0 = fixed mu
  qWin: number; // assumed win prob when bidding ~ the estimated clearing price
  inc: number; // future cash as a fraction of balance (word income still to come)
  lamMin: number; // bounds for the score-per-coin threshold
  lamMax: number;
  prior: number; // pseudo-observations for the price model prior
  hiBoost: number; // bid multiplier for heavy letters J Q X Z K (live winners bid 34-60 on these)
  hiCapFrac: number; // ...but never more than this fraction of balance on one heavy tile
  budget: number; // partition node budget
}

export const DEFAULT_PARAMS: Params = {
  hiBoost: 1,
  hiCapFrac: 0.25,
  kEarly: 2.13,
  kEnd: 0.4,
  kRamp: 39,
  tEarly: 2.11,
  kPlay: 1.39,
  tPlay: 1.65,
  mu: 1,
  endMu: 1.76,
  endRem: 6,
  pace: 6.41,
  minCap: 10.32,
  playLen: 4,
  cashLow: 6.34,
  cashLen: 4,
  liqRem: 2,
  liqKappa: 0.3,
  jitter: 0.08,
  denial: 0,
  budget: 3000,
  adaptive: 1,
  qWin: 0.6,
  inc: 0.5,
  lamMin: 0.15,
  lamMax: 1.5,
  prior: 6,
};

const d = loadDict();

function kappaAt(p: Params, rem: number): number {
  const t = Math.min(1, rem / p.kRamp);
  return p.kEnd + (p.kEarly - p.kEnd) * t;
}
function tauAt(p: Params, rem: number): number {
  return p.tEarly * Math.min(1, rem / p.kRamp);
}

export function marginalValue(p: Params, rack: Counts, L: string, rem: number): number {
  const opts = { kappa: kappaAt(p, rem), tau: tauAt(p, rem), nodeBudget: p.budget, timeMs: 70 };
  const base = bestPartition(d, rack, opts).value;
  const r2 = rack.slice();
  r2[li(L)]!++;
  const withL = bestPartition(d, r2, opts).value;
  return Math.max(0, withL - base);
}

/** First-price shading: estimate of the max rival bid for a letter with this face value. */
function rivalEstimate(v: BotView, L: string): number {
  const fv = letterValue(L);
  const xs: number[] = [];
  for (const h of v.history) {
    if (h.winner === v.me || h.winner < 0) continue;
    if (Math.abs(letterValue(h.letter) - fv) <= (fv >= 4 ? 2 : 0)) xs.push(h.paid);
  }
  if (xs.length < 3) return fv + 4;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(0.85 * (xs.length - 1))]!;
}

/** Clearing price ~ a + b*face, weighted least squares over this match's paid stream + prior. */
export function priceModel(v: BotView, prior: number): { a: number; b: number } {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  const add = (x: number, y: number, w: number) => { sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y; };
  add(1, 6, prior / 2); add(4, 15, prior / 2); // prior from recon: ~3 + 3*face
  for (const h of v.history) if (h.winner >= 0 && h.paid > 0) add(letterValue(h.letter), h.paid, 1);
  const den = sw * sxx - sx * sx;
  let b = den > 1e-9 ? (sw * sxy - sx * sy) / den : 3;
  b = Math.max(0.5, Math.min(8, b));
  const a = (sy - b * sx) / sw;
  return { a, b };
}

/** Score-per-coin threshold that spends the effective budget over the remaining auctions. */
export function lambdaFor(p: Params, v: BotView, L: string, rem: number): number {
  const { a, b } = priceModel(v, p.prior);
  const unseen = BAG_COUNTS.slice();
  for (let i = 0; i < 26; i++) unseen[i]! -= v.rack[i]!;
  for (const h of v.history) unseen[li(h.letter)]!--;
  unseen[li(L)]!--;
  let U = 0;
  for (let i = 0; i < 26; i++) { if (unseen[i]! < 0) unseen[i] = 0; U += unseen[i]!; }
  if (U <= 0) return p.lamMin;
  const kappa = kappaAt(p, rem), tau = tauAt(p, rem);
  const items: { r: number; spend: number }[] = [];
  let totalSpend = 0;
  for (let i = 0; i < 26; i++) {
    if (!unseen[i]) continue;
    const price = Math.max(1, a + b * VALUE[i]!);
    const val = kappa * VALUE[i]! + tau;
    const spend = (rem * unseen[i]! / U) * price * p.qWin;
    items.push({ r: val / price, spend });
    totalSpend += spend;
  }
  items.sort((x, y) => y.r - x.r);
  const B = v.balance * (1 + p.inc);
  let lam: number;
  if (totalSpend <= B) lam = items[items.length - 1]!.r * (totalSpend / Math.max(1, B));
  else {
    let cum = 0; lam = items[items.length - 1]!.r;
    for (const it of items) { cum += it.spend; if (cum >= B) { lam = it.r; break; } }
  }
  return Math.max(p.lamMin, Math.min(p.lamMax, lam));
}
void LETTERS;

export function makeChampion(p: Params = DEFAULT_PARAMS, name = "champion"): BotFactory {
  return {
    name,
    create(): BotInstance {
      return {
        decideBid(v: BotView, L: string): number {
          const rem = v.bagTotal; // auctions still to come after this one
          if (rem <= 0) return 0; // final auction: tile can never be played
          if (v.balance <= 0) return 0;
          const val = marginalValue(p, v.rack, L, rem) + p.denial * letterValue(L);
          let mu = p.adaptive ? p.mu / lambdaFor(p, v, L, rem) : p.mu;
          if (rem <= p.endRem) mu *= p.endMu;
          let bid = val * mu;
          let cap = Math.max(p.minCap, v.balance * Math.min(1, p.pace / rem));
          if (p.hiBoost !== 1 && "JQXZK".includes(L) && rem > 2) {
            // Q without a U is near-useless: only boost Q if we hold a U
            if (L !== "Q" || v.rack[li("U")]! > 0) { bid *= p.hiBoost; cap = Math.max(cap, v.balance * p.hiCapFrac); }
          }
          bid = Math.min(bid, cap);
          if (v.auctionType === "FirstPrice") bid = Math.min(bid, rivalEstimate(v, L) + 1);
          bid *= 1 + p.jitter * (2 * v.rng() - 1);
          bid = Math.round(bid);
          if (bid < 1 && val > 0.5) bid = 1;
          return Math.max(0, Math.min(bid, v.balance));
        },
        chooseWords(v: BotView): string[] {
          const rem = v.bagTotal;
          if (rem <= p.liqRem) {
            const kappa = rem <= 0 ? 0 : p.liqKappa;
            return bestPartition(d, v.rack, { kappa, nodeBudget: p.budget * 4, timeMs: 250 }).words;
          }
          const poor = v.balance < p.cashLow;
          const part = bestPartition(d, v.rack, { kappa: p.kPlay, tau: p.tPlay, nodeBudget: p.budget, timeMs: 120 });
          const minLen = poor ? p.cashLen : p.playLen;
          return part.words.filter((w) => w.length >= minLen);
        },
      };
    },
  };
}

export const Champion = makeChampion();
void VALUE;
