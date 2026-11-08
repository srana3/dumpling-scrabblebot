// Headless, seeded replica of spacetimedb/src/game.ts match flow.
import { loadDict, serverBestPlayable } from "../engine/dict.js";
import { BAG_COUNTS, LETTERS, VALUE, emptyCounts, li, wordReward, total, type Counts } from "../engine/letters.js";
import type { AuctionRecord, AuctionType, BotFactory, BotInstance, BotView, PlayerPublic, WordRecord } from "../engine/types.js";

export type SimStrategy = "Cheapskate" | "ValueBidder" | "Aggressive";
export type SeatSpec = { kind: "sim"; strategy: SimStrategy; name?: string } | { kind: "bot"; factory: BotFactory };

export const SIM_POOL: { name: string; strategy: SimStrategy }[] = [
  { name: "Cheapo", strategy: "Cheapskate" },
  { name: "Valor", strategy: "ValueBidder" },
  { name: "Brutus", strategy: "Aggressive" },
  { name: "Hagrid", strategy: "ValueBidder" },
  { name: "Maverick", strategy: "Aggressive" },
  { name: "Snippet", strategy: "Cheapskate" },
];

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const intIn = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

export function simBid(strategy: SimStrategy, letter: string, balance: number, jitter: number): number {
  const v = VALUE[li(letter)]!;
  const vowel = "AEIOU".includes(letter);
  const base = strategy === "Cheapskate" ? v - 1 : strategy === "ValueBidder" ? v : v + (vowel ? 4 : 2);
  return Math.max(Math.min(Math.max(base + jitter, 1), balance), 0);
}

export interface SeatResult {
  name: string;
  score: number;
  balance: number;
  place: number; // 1 = best; ties share the better place
  tilesWon: number;
  spent: number;
  words: string[];
  leftover: number; // tiles unplayed at end
  bidErrors: number;
  maxDecisionMs: number;
}
export interface MatchResult { seats: SeatResult[]; rounds: number }

export interface MatchOpts {
  seed: number;
  seats: SeatSpec[];
  auctionType?: AuctionType;
  rackSize?: number;
  timing?: boolean;
}

export function runMatch(o: MatchOpts): MatchResult {
  const d = loadDict();
  const n = o.seats.length;
  const auctionType = o.auctionType ?? "Vickrey";
  const rackSize = o.rackSize ?? 5;
  const bagRng = mulberry32(o.seed);
  const tieRng = mulberry32(o.seed ^ 0x9e3779b9);
  // bag as a random permutation (equivalent to uniform draws without replacement)
  const bag: string[] = [];
  BAG_COUNTS.forEach((c, i) => { for (let k = 0; k < c; k++) bag.push(LETTERS[i]!); });
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(bagRng() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; }
  let bi = 0;
  const draw = () => (bi < bag.length ? bag[bi++]! : undefined);
  const bagLeft = () => bag.length - bi;

  const racks: Counts[] = o.seats.map(() => emptyCounts());
  const bal = o.seats.map(() => 100);
  const score = o.seats.map(() => 0);
  const tilesWon = o.seats.map(() => 0);
  const spent = o.seats.map(() => 0);
  const played: string[][] = o.seats.map(() => []);
  const bidErrors = o.seats.map(() => 0);
  const maxMs = o.seats.map(() => 0);
  const seatRng = o.seats.map((_, s) => mulberry32((o.seed * 31 + s * 7919) ^ 0x5bd1e995));
  const insts: (BotInstance | null)[] = o.seats.map((s, i) => (s.kind === "bot" ? s.factory.create(o.seed * 13 + i) : null));
  const history: AuctionRecord[] = [];
  const words: WordRecord[] = [];

  for (let s = 0; s < n; s++) for (let k = 0; k < rackSize; k++) { const L = draw(); if (L) racks[s]![li(L)]!++; }

  let round = 1;
  const view = (s: number): BotView => ({
    round, bagTotal: bagLeft(), balance: bal[s]!, score: score[s]!, rack: racks[s]!.slice(), me: s, nPlayers: n, rackSize,
    auctionType, players: o.seats.map((_, j): PlayerPublic => ({ seat: j, balance: bal[j]!, score: score[j]! })),
    history, words, rng: seatRng[s]!,
  });
  const timed = <T>(s: number, f: () => T): T => {
    if (!o.timing) return f();
    const t = performance.now(); const r = f(); const dt = performance.now() - t;
    if (dt > maxMs[s]!) maxMs[s] = dt; return r;
  };
  const play = (s: number, w: string): boolean => {
    if (w.length < 2 || !d.set.has(w)) return false;
    const r = racks[s]!; const need = emptyCounts();
    for (const ch of w) need[li(ch)]!++;
    for (let c = 0; c < 26; c++) if (need[c]! > r[c]!) return false;
    for (let c = 0; c < 26; c++) r[c]! -= need[c]!;
    const rw = wordReward(w);
    bal[s]! += rw; score[s]! += rw; played[s]!.push(w);
    words.push({ round, seat: s, word: w, reward: rw });
    return true;
  };

  let letter = draw();
  while (letter !== undefined) {
    // --- bids (sims bid at open; clients react to the open auction) ---
    const bids: { seat: number; amount: number }[] = [];
    for (let s = 0; s < n; s++) {
      const spec = o.seats[s]!;
      let amt: number;
      if (spec.kind === "sim") {
        amt = simBid(spec.strategy, letter, bal[s]!, intIn(seatRng[s]!, -2, 2));
      } else {
        const L = letter;
        amt = Math.floor(timed(s, () => insts[s]!.decideBid(view(s), L)));
        if (!Number.isFinite(amt)) amt = 0;
        if (amt > bal[s]!) { bidErrors[s]!++; amt = 0; } // reducer would reject
      }
      if (amt > 0) bids.push({ seat: s, amount: amt });
    }
    // --- close: shuffle then stable sort desc ---
    for (let i = bids.length - 1; i >= 1; i--) { const j = Math.floor(tieRng() * (i + 1)); [bids[i], bids[j]] = [bids[j]!, bids[i]!]; }
    bids.sort((a, b) => b.amount - a.amount);
    let winner = -1, paid = 0;
    if (bids.length) {
      winner = bids[0]!.seat;
      paid = auctionType === "FirstPrice" ? bids[0]!.amount : bids[1] ? bids[1]!.amount : Math.min(1, bids[0]!.amount);
      if (bal[winner]! >= paid) {
        bal[winner]! -= paid; spent[winner]! += paid; tilesWon[winner]!++;
        racks[winner]![li(letter)]!++;
      }
    }
    history.push({ round, letter, winner, paid });
    if (winner >= 0 && o.seats[winner]!.kind === "sim") {
      const w = serverBestPlayable(d, racks[winner]!, 3);
      if (w) play(winner, w);
    }
    letter = draw();
    if (letter === undefined) break; // match ends in the same transaction
    round++;
    // --- client word plays during the next auction window (random order) ---
    const order = Array.from({ length: n }, (_, i) => i).sort(() => tieRng() - 0.5);
    for (const s of order) {
      if (!insts[s]) continue;
      const ws = timed(s, () => insts[s]!.chooseWords(view(s)));
      for (const w of ws) play(s, w);
    }
  }

  const seats: SeatResult[] = o.seats.map((sp, s) => ({
    name: sp.kind === "sim" ? sp.name ?? sp.strategy : sp.factory.name,
    score: score[s]!, balance: bal[s]!, place: 1 + score.filter((x) => x > score[s]!).length,
    tilesWon: tilesWon[s]!, spent: spent[s]!, words: played[s]!, leftover: total(racks[s]!),
    bidErrors: bidErrors[s]!, maxDecisionMs: maxMs[s]!,
  }));
  return { seats, rounds: round };
}
