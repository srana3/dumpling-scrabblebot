// Opponent zoo. Server sims are driven by the simulator itself (see sim/match.ts, kind "sim"),
// because they act inside the server transaction; everything else here is a normal client bot.
import { loadDict, serverBestPlayable, formable } from "../engine/dict.js";
import { VALUE, li, letterValue, total, type Counts } from "../engine/letters.js";
import { bestPartition } from "../engine/partition.js";
import type { BotFactory, BotInstance, BotView } from "../engine/types.js";

const d = loadDict();
const clampBid = (b: number, v: BotView) => Math.max(0, Math.min(Math.floor(b), v.balance));

/** bot-starter/src/strategy.ts clone: value+2 if not held, else max(1,value); plays longest word on every rack change. */
export const Starter: BotFactory = {
  name: "starter",
  create: () => ({
    decideBid(v, L) {
      const val = letterValue(L);
      const want = v.rack[li(L)]! === 0 ? val + 2 : Math.max(1, val);
      return clampBid(want, v);
    },
    chooseWords(v) {
      const w = serverBestPlayable(d, v.rack, 2);
      return w ? [w] : [];
    },
  }),
};

/** Starter variant that loops: keeps playing longest words until none left. */
export const StarterGreedy: BotFactory = {
  name: "starterGreedy",
  create: () => ({
    decideBid: Starter.create(0).decideBid,
    chooseWords(v) {
      const r = v.rack.slice();
      const out: string[] = [];
      for (;;) {
        const w = serverBestPlayable(d, r, 2);
        if (!w) break;
        out.push(w);
        for (const ch of w) r[li(ch)]!--;
      }
      return out;
    },
  }),
};

function playAll(v: BotView, minLen: number, kappa = 0): string[] {
  return bestPartition(d, v.rack, { kappa, nodeBudget: 2000 }).words.filter((w) => w.length >= minLen);
}

/** Hoarder: bids 2x face for everything (up to budget pacing), plays only 7+ words, liquidates at end. */
export const Hoarder: BotFactory = {
  name: "hoarder",
  create: () => ({
    decideBid(v, L) {
      if (v.bagTotal === 0) return 0;
      return clampBid(Math.min(2 * letterValue(L) + 2, v.balance / 4), v);
    },
    chooseWords(v) {
      if (v.bagTotal <= 2) return playAll(v, 2);
      return playAll(v, 7, 2.2);
    },
  }),
};

/** All-in: bids entire balance every auction; plays greedy partition every time. */
export const AllIn: BotFactory = {
  name: "allin",
  create: () => ({
    decideBid(v) { return v.bagTotal === 0 ? 0 : v.balance; },
    chooseWords(v) { return playAll(v, 2); },
  }),
};

/** Rare-letter chaser: overbids on JQXZK, face otherwise, plays greedy. */
export const RareChaser: BotFactory = {
  name: "rare",
  create: () => ({
    decideBid(v, L) {
      const val = letterValue(L);
      return clampBid("JQXZK".includes(L) ? val * 3 : val, v);
    },
    chooseWords(v) { return playAll(v, 2); },
  }),
};

/** Cash-flow spammer: plays any word ASAP to keep cash, bids face+3. */
export const Spammer: BotFactory = {
  name: "spammer",
  create: () => ({
    decideBid(v, L) { return clampBid(letterValue(L) + 3, v); },
    chooseWords(v) { return playAll(v, 2); },
  }),
};

/** Copycat: bids last paid price + 1. */
export const Copycat: BotFactory = {
  name: "copycat",
  create: () => ({
    decideBid(v, L) {
      const last = v.history.length ? v.history[v.history.length - 1]!.paid : letterValue(L);
      return v.bagTotal === 0 ? 0 : clampBid(Math.max(last + 1, letterValue(L)), v);
    },
    chooseWords(v) { return playAll(v, 4, 1.0); },
  }),
};

/** Price-jammer: bids high (3x face+3) on everything to drain Vickrey winners; plays long-ish words. */
export const Jammer: BotFactory = {
  name: "jammer",
  create: () => ({
    decideBid(v, L) {
      if (v.bagTotal === 0) return 0;
      return clampBid(Math.min(3 * letterValue(L) + 3, v.balance * 0.5), v);
    },
    chooseWords(v) { return v.bagTotal <= 3 ? playAll(v, 2) : playAll(v, 5, 1.6); },
  }),
};

/** Budget-saver: bids face only while balance > 60, then 1s; liquidates at end. */
export const Saver: BotFactory = {
  name: "saver",
  create: () => ({
    decideBid(v, L) { return clampBid(v.balance > 60 ? letterValue(L) + 1 : 1, v); },
    chooseWords(v) { return v.bagTotal <= 3 ? playAll(v, 2) : playAll(v, 6, 2); },
  }),
};

/** Value hoarder: the "smart rival" archetype — marginal partition value bidding with moderate kappa. */
export const SmartRival: BotFactory = {
  name: "smart",
  create: () => ({
    decideBid(v, L) {
      if (v.bagTotal === 0) return 0;
      const kappa = v.bagTotal > 10 ? 1.8 : 0.8;
      const base = bestPartition(d, v.rack, { kappa, nodeBudget: 1500 }).value;
      const r2 = v.rack.slice(); r2[li(L)]!++;
      const withL = bestPartition(d, r2, { kappa, nodeBudget: 1500 }).value;
      return clampBid(Math.min(withL - base, v.balance / 3), v);
    },
    chooseWords(v) { return v.bagTotal <= 3 ? playAll(v, 2) : playAll(v, 7, 2); },
  }),
};

export const ZOO: Record<string, BotFactory> = {
  starter: Starter, starterGreedy: StarterGreedy, hoarder: Hoarder, allin: AllIn, rare: RareChaser,
  spammer: Spammer, copycat: Copycat, jammer: Jammer, saver: Saver, smart: SmartRival,
};
export const HOLDOUT = ["copycat", "saver", "smart"]; // never used for tuning
void VALUE; void total; void formable;
export type { Counts };
