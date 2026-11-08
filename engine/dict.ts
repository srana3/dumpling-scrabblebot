// Precomputed dictionary index: letter-count vectors, masks, rewards.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VALUE, rewardFor, type Counts } from "./letters.js";

export interface Dict {
  words: string[]; // lex-sorted (server order)
  n: number;
  len: Uint8Array;
  base: Uint16Array;
  reward: Uint16Array;
  mask: Uint32Array;
  counts: Uint8Array; // n*26
  set: Set<string>;
  /** server's findBestPlayable order: length desc, then lex asc */
  byLenDesc: Int32Array;
}

let DICT: Dict | undefined;

export function loadDict(): Dict {
  if (DICT) return DICT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(here, "wordlist.txt"), "utf8");
  const words = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && /^[A-Z]+$/.test(l));
  const n = words.length;
  const len = new Uint8Array(n);
  const base = new Uint16Array(n);
  const reward = new Uint16Array(n);
  const mask = new Uint32Array(n);
  const counts = new Uint8Array(n * 26);
  for (let i = 0; i < n; i++) {
    const w = words[i]!;
    let b = 0;
    let m = 0;
    for (let k = 0; k < w.length; k++) {
      const c = w.charCodeAt(k) - 65;
      counts[i * 26 + c]!++;
      b += VALUE[c]!;
      m |= 1 << c;
    }
    len[i] = w.length;
    base[i] = b;
    reward[i] = rewardFor(b, w.length);
    mask[i] = m >>> 0;
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => len[b]! - len[a]! || (words[a]! < words[b]! ? -1 : words[a]! > words[b]! ? 1 : 0));
  DICT = { words, n, len, base, reward, mask, counts, set: new Set(words), byLenDesc: Int32Array.from(idx) };
  return DICT;
}

export function rackMask(rack: Counts): number {
  let m = 0;
  for (let i = 0; i < 26; i++) if (rack[i]! > 0) m |= 1 << i;
  return m >>> 0;
}

export function fits(d: Dict, wi: number, rack: Counts): boolean {
  const o = wi * 26;
  for (let c = 0; c < 26; c++) if (d.counts[o + c]! > rack[c]!) return false;
  return true;
}

/** All dictionary word indices spellable from rack (minLen..). */
export function formable(d: Dict, rack: Counts, minLen = 2): number[] {
  const m = rackMask(rack);
  const notM = ~m >>> 0;
  let tot = 0;
  for (let i = 0; i < 26; i++) tot += rack[i]!;
  const out: number[] = [];
  for (let i = 0; i < d.n; i++) {
    if ((d.mask[i]! & notM) !== 0) continue;
    const L = d.len[i]!;
    if (L > tot || L < minLen) continue;
    if (fits(d, i, rack)) out.push(i);
  }
  return out;
}

/** Exact replica of the server's findBestPlayable(rack, minLen). */
export function serverBestPlayable(d: Dict, rack: Counts, minLen: number): string | undefined {
  let tot = 0;
  for (let i = 0; i < 26; i++) tot += rack[i]!;
  if (tot < minLen) return undefined;
  const m = rackMask(rack);
  const notM = ~m >>> 0;
  const order = d.byLenDesc;
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const L = d.len[i]!;
    if (L < minLen) break;
    if (L > tot) continue;
    if ((d.mask[i]! & notM) !== 0) continue;
    if (fits(d, i, rack)) return d.words[i];
  }
  return undefined;
}

/** Starter-bot chooseWord: longest playable (any length >=2); ties in its sort order (stable length-desc over lex list). */
export function starterBestPlayable(d: Dict, rack: Counts): string | undefined {
  return serverBestPlayable(d, rack, 2);
}
