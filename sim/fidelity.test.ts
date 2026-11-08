// Fidelity tests mirroring rules in spacetimedb/src/game.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordReward, countsFromString } from "../engine/letters.js";
import { loadDict, serverBestPlayable } from "../engine/dict.js";
import { bestPartition } from "../engine/partition.js";
import { runMatch, simBid, type SeatSpec } from "./match.js";
import type { BotFactory } from "../engine/types.js";

test("reward = base * length multiplier, integer division", () => {
  assert.equal(wordReward("AT"), 2);
  assert.equal(wordReward("CAT"), 5);
  assert.equal(wordReward("CATS"), Math.floor((6 * 3) / 2)); // 9
  assert.equal(wordReward("QUOTA"), 14 * 2);
  assert.equal(wordReward("QUOTAS"), Math.floor((15 * 5) / 2)); // 37
  assert.equal(wordReward("ZEPHYRS"), 24 * 3);
});

test("sim bids: Cheapskate v-1, Value v, Aggressive v+4 vowel / v+2, jitter, clamp [1,balance]", () => {
  assert.equal(simBid("Cheapskate", "A", 100, 0), 1); // max(0,1)
  assert.equal(simBid("ValueBidder", "Q", 100, 2), 12);
  assert.equal(simBid("Aggressive", "E", 100, -2), 3);
  assert.equal(simBid("Aggressive", "Z", 5, 2), 5);
  assert.equal(simBid("Cheapskate", "E", 0, 0), 0);
});

test("server findBestPlayable: longest, then lexicographically first", () => {
  const d = loadDict();
  const w = serverBestPlayable(d, countsFromString("TACO"), 3)!;
  assert.equal(w.length, 4);
  assert.equal(w, ["COAT", "TACO"].sort()[0]);
  assert.equal(serverBestPlayable(d, countsFromString("QZ"), 3), undefined);
});

test("partition never reuses tiles and only returns dictionary words", () => {
  const d = loadDict();
  const rack = countsFromString("AEEINRSTTOLQUZ");
  const p = bestPartition(d, rack, { kappa: 0 });
  const used = countsFromString(p.words.join(""));
  for (let i = 0; i < 26; i++) assert.ok(used[i]! <= rack[i]!);
  for (const w of p.words) assert.ok(d.set.has(w));
  assert.equal(p.wordValue, p.words.reduce((a, w) => a + wordReward(w), 0));
});

function scripted(name: string, bid: (letter: string, bag: number) => number, words: (bag: number) => string[] = () => []): BotFactory {
  return { name, create: () => ({ decideBid: (v, L) => bid(L, v.bagTotal), chooseWords: (v) => words(v.bagTotal) }) };
}

test("68 auctions in a 6-seat match; Vickrey pays second price; lone bidder pays 1", () => {
  const seen: number[] = [];
  const a = scripted("a", (_L, bag) => { seen.push(bag); return 10; });
  const b = scripted("b", () => 4);
  const z = scripted("z", () => 0);
  const seats: SeatSpec[] = [a, b, z, z, z, z].map((f) => ({ kind: "bot", factory: f }));
  const r = runMatch({ seed: 7, seats });
  assert.equal(r.rounds, 68);
  assert.equal(seen[0], 67);
  assert.equal(seen[seen.length - 1], 0); // final auction is open with bagTotal 0
  // a wins until it can't afford 10 > balance... it pays 4 each time
  assert.equal(r.seats[0]!.spent % 4, 0);
  const lone = runMatch({ seed: 7, seats: [a, z, z, z, z, z].map((f) => ({ kind: "bot", factory: f })) });
  assert.equal(lone.seats[0]!.spent, 68); // paid reserve 1 each
});

test("first-price pays own bid; unbid tiles are discarded (not returned)", () => {
  const a = scripted("a", (_L, bag) => (bag % 2 === 0 ? 1 : 0));
  const z = scripted("z", () => 0);
  const r = runMatch({ seed: 3, seats: [a, z, z, z, z, z].map((f) => ({ kind: "bot", factory: f })), auctionType: "FirstPrice" });
  assert.equal(r.rounds, 68);
  assert.equal(r.seats[0]!.tilesWon, 34);
  assert.equal(r.seats[0]!.spent, 34);
});

test("tile won in the final auction is never playable", () => {
  let gotFinal = false;
  const a: BotFactory = {
    name: "a",
    create: () => ({
      decideBid: (v) => (v.bagTotal === 0 ? 1 : 0),
      chooseWords: (v) => { if (v.bagTotal === 0) gotFinal = true; return []; },
    }),
  };
  const z = scripted("z", () => 0);
  const r = runMatch({ seed: 5, seats: [a, z, z, z, z, z].map((f) => ({ kind: "bot", factory: f })) });
  assert.equal(r.seats[0]!.tilesWon, 1);
  assert.equal(r.seats[0]!.leftover, 6); // 5 start + final tile, never got a chance after winning it
  assert.ok(gotFinal); // chooseWords is called while the final auction is open
});
