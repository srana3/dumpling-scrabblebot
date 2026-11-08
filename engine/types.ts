// The pure decision interface shared by the simulator and the live bot.
import type { Counts } from "./letters.js";

export type AuctionType = "Vickrey" | "FirstPrice";

export interface AuctionRecord {
  round: number;
  letter: string;
  winner: number; // seat index, -1 = no bids
  paid: number;
}
export interface WordRecord {
  round: number;
  seat: number;
  word: string;
  reward: number;
}
export interface PlayerPublic {
  seat: number;
  balance: number;
  score: number;
}

export interface BotView {
  round: number; // 1-based auction number currently open
  bagTotal: number; // tiles left in bag while this auction is open (0 => final auction)
  balance: number;
  score: number;
  rack: Counts; // our tiles
  me: number; // our seat
  nPlayers: number;
  rackSize: number; // starting rack size
  auctionType: AuctionType;
  players: PlayerPublic[];
  history: AuctionRecord[]; // closed auctions, oldest first
  words: WordRecord[]; // all public word plays
  rng: () => number;
}

export interface BotInstance {
  /** Bid for the open auction's letter. Return 0 to skip. Must be <= balance. */
  decideBid(v: BotView, letter: string): number;
  /** Words to play now (must be simultaneously spellable from the rack). */
  chooseWords(v: BotView): string[];
}

export interface BotFactory {
  name: string;
  create(seed: number): BotInstance;
}
