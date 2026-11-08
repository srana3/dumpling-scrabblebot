// Champion strategy ("dumpling"). Pure functions of the public BotView; used verbatim by sim and live bot.
import { loadDict } from "../engine/dict.js";
import { VALUE, li, letterValue, type Counts } from "../engine/letters.js";
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
  budget: number; // partition node budget
}

export const DEFAULT_PARAMS: Params = {
  kEarly: 2.0,
  kEnd: 0.4,
  kRamp: 25,
  tEarly: 2.0,
  kPlay: 1.2,
  tPlay: 0.5,
  mu: 1.0,
  endMu: 1.5,
  endRem: 6,
  pace: 8,
  minCap: 6,
  playLen: 7,
  cashLow: 12,
  cashLen: 5,
  liqRem: 2,
  liqKappa: 0.3,
  jitter: 0.08,
  denial: 0,
  budget: 3000,
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
  const opts = { kappa: kappaAt(p, rem), tau: tauAt(p, rem), nodeBudget: p.budget };
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
          let mu = p.mu;
          if (rem <= p.endRem) mu *= p.endMu;
          let bid = val * mu;
          const cap = Math.max(p.minCap, v.balance * Math.min(1, p.pace / rem));
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
            return bestPartition(d, v.rack, { kappa, nodeBudget: p.budget * 4 }).words;
          }
          const poor = v.balance < p.cashLow;
          const part = bestPartition(d, v.rack, { kappa: p.kPlay, tau: p.tPlay, nodeBudget: p.budget });
          const minLen = poor ? p.cashLen : p.playLen;
          return part.words.filter((w) => w.length >= minLen);
        },
      };
    },
  };
}

export const Champion = makeChampion();
void VALUE;
