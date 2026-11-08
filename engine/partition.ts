// Max-value partition of a rack into dictionary words (anytime branch & bound).
// value = sum(reward of words) + kappa * sum(face value of unused tiles)
// kappa models the option value of a tile kept for later (0 at the very end).
import { VALUE, type Counts } from "./letters.js";
import { formable, fits, type Dict } from "./dict.js";

export interface Partition {
  value: number; // includes kappa * unused
  wordValue: number; // sum of word rewards only
  words: string[];
}

export interface PartitionOpts {
  kappa?: number;
  tau?: number; // extra option value per unused tile (enabling value, independent of face)
  minLen?: number;
  nodeBudget?: number;
  perLetter?: number; // max candidates considered per branching letter
  timeMs?: number; // wall-clock cap for the search (anytime: returns best found)
}

export function bestPartition(d: Dict, rack: Counts, opts: PartitionOpts = {}): Partition {
  const kappa = opts.kappa ?? 0;
  const tau = opts.tau ?? 0;
  const minLen = opts.minLen ?? 2;
  const budget = opts.nodeBudget ?? 6000;
  const perLetter = opts.perLetter ?? 40;
  const deadline = performance.now() + (opts.timeMs ?? 60);
  let timeUp = false;
  const all = formable(d, rack, minLen);
  // Drop dominated words (reward no better than leaving letters unused).
  const cand = all.filter((i) => d.reward[i]! > kappa * d.base[i]! + tau * d.len[i]! + 1e-9);
  // Sort by reward desc, then by "efficiency" (reward per tile) for ties.
  cand.sort((a, b) => d.reward[b]! - d.reward[a]! || d.len[a]! - d.len[b]!);
  const lists: number[][] = Array.from({ length: 26 }, () => []);
  for (const i of cand) {
    const o = i * 26;
    for (let c = 0; c < 26; c++) if (d.counts[o + c]! > 0) lists[c]!.push(i);
  }
  const order = Array.from({ length: 26 }, (_, c) => c).sort((a, b) => lists[a]!.length - lists[b]!.length);

  const r = rack.slice();
  let face = 0;
  let tiles = 0;
  for (let c = 0; c < 26; c++) { face += r[c]! * VALUE[c]!; tiles += r[c]!; }
  let best = kappa * face + tau * tiles;
  let bestWords: number[] = [];
  const stack: number[] = [];
  const seen = new Map<string, number>();
  let nodes = 0;

  function dfs(acc: number, faceLeft: number, tilesLeft: number) {
    // feasible: drop everything left
    const here = acc + kappa * faceLeft + tau * tilesLeft;
    if (here > best) { best = here; bestWords = stack.slice(); }
    if (acc + Math.max(3, kappa) * faceLeft + tau * tilesLeft <= best) return;
    if (timeUp || nodes++ > budget) return;
    if ((nodes & 255) === 0 && performance.now() > deadline) { timeUp = true; return; }
    const k = String.fromCharCode(...r);
    const s = seen.get(k);
    if (s !== undefined && s >= acc) return;
    seen.set(k, acc);
    let c = -1;
    for (const x of order) if (r[x]! > 0) { c = x; break; }
    if (c < 0) return;
    const lst = lists[c]!;
    let tried = 0;
    for (let j = 0; j < lst.length && tried < perLetter; j++) {
      const w = lst[j]!;
      if (!fits(d, w, r)) continue;
      tried++;
      const o = w * 26;
      for (let x = 0; x < 26; x++) r[x]! -= d.counts[o + x]!;
      stack.push(w);
      dfs(acc + d.reward[w]!, faceLeft - d.base[w]!, tilesLeft - d.len[w]!);
      stack.pop();
      for (let x = 0; x < 26; x++) r[x]! += d.counts[o + x]!;
      if (timeUp || nodes > budget) break;
    }
    // leave one copy of c unused
    r[c]!--;
    dfs(acc + kappa * VALUE[c]! + tau, faceLeft - VALUE[c]!, tilesLeft - 1);
    r[c]!++;
  }
  dfs(0, face, tiles);
  let wordValue = 0;
  const words = bestWords.map((w) => { wordValue += d.reward[w]!; return d.words[w]!; });
  return { value: best, wordValue, words };
}
