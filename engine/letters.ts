// Game constants mirrored from spacetimedb/src/letters.ts. Pure, shared by sim and live bot.
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const VALUE: number[] = [
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10,
];
export const BAG_COUNTS: number[] = [
  9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2, 1,
];
export const BAG_SIZE = 98;
export const VOWEL = [0, 4, 8, 14, 20]; // A E I O U

export function li(c: string): number {
  return c.charCodeAt(0) - 65;
}
export function letterValue(c: string): number {
  return VALUE[li(c)] ?? 0;
}
export function isVowelIdx(i: number): boolean {
  return i === 0 || i === 4 || i === 8 || i === 14 || i === 20;
}

/** totalReward = base * num / denom, integer division (matches server bigint math). */
export function rewardFor(base: number, len: number): number {
  if (len <= 3) return base;
  if (len === 4) return Math.floor((base * 3) / 2);
  if (len === 5) return base * 2;
  if (len === 6) return Math.floor((base * 5) / 2);
  return base * 3;
}
export function multiplier(len: number): number {
  return len <= 3 ? 1 : len === 4 ? 1.5 : len === 5 ? 2 : len === 6 ? 2.5 : 3;
}
export function wordReward(w: string): number {
  let b = 0;
  for (let i = 0; i < w.length; i++) b += VALUE[w.charCodeAt(i) - 65]!;
  return rewardFor(b, w.length);
}

export type Counts = number[]; // length 26

export function emptyCounts(): Counts {
  return new Array(26).fill(0);
}
export function countsFromString(s: string): Counts {
  const c = emptyCounts();
  for (const ch of s) c[li(ch)]!++;
  return c;
}
export function countsToString(c: Counts): string {
  let s = "";
  for (let i = 0; i < 26; i++) s += LETTERS[i]!.repeat(c[i]!);
  return s;
}
export function total(c: Counts): number {
  let t = 0;
  for (let i = 0; i < 26; i++) t += c[i]!;
  return t;
}
