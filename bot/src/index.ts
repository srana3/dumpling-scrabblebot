// dumpling live client. Uses only join_lobby / submit_bid / submit_word (+ register_for_tournament when TOURNAMENT_ID set).
//   npm start                       (reads BOT_TOKEN from env, ./.env, or ./.token-<BOT_NAME>)
//   TOURNAMENT_ID=<id> npm start    (registers for a tournament on connect)
//   MAX_MATCHES=2 npm start         (exit after N matches; for recon)
//   LOBBY=0 TOURNAMENT_ID=<id> npm start  (tournament only; never joins lobby matches)
import { DbConnection, tables, type ErrorContext } from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import * as fs from "node:fs";
import * as path from "node:path";
import { Champion } from "../strategy.js";
import { emptyCounts, li, wordReward, type Counts } from "../../engine/letters.js";
import type { AuctionRecord, BotInstance, BotView, WordRecord } from "../../engine/types.js";

const ROOT = process.cwd();
function dotenv(): Record<string, string> {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
    );
  } catch { return {}; }
}
const ENV = { ...dotenv(), ...process.env } as Record<string, string | undefined>;
const HOST = ENV.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = ENV.STDB_DB ?? "scrabblebot";
const BOT_NAME = ENV.BOT_NAME ?? "dumpling";
const TOURNAMENT_ID = ENV.TOURNAMENT_ID;
const MAX_MATCHES = ENV.MAX_MATCHES ? +ENV.MAX_MATCHES : Infinity;
const TOKEN_PATH = path.join(ROOT, `.token-${BOT_NAME}`);
const LOG_DIR = path.join(ROOT, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `live-${new Date().toISOString().slice(0, 10)}.jsonl`);

function log(ev: string, data: Record<string, unknown> = {}) {
  const row = { t: Date.now(), ev, ...data };
  fs.appendFileSync(LOG_FILE, JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? Number(v) : v)) + "\n");
}
function say(msg: string) { console.log(`${new Date().toISOString().slice(11, 23)} [${BOT_NAME}] ${msg}`); }
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function loadToken(): string | undefined {
  if (ENV.BOT_TOKEN) return ENV.BOT_TOKEN;
  try { return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined; } catch { return undefined; }
}

// ---------------- state ----------------
let conn: DbConnection | null = null;
let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
let matchesDone = 0;
const instances = new Map<bigint, BotInstance>();
const bidDone = new Set<bigint>(); // auction ids we've bid on
const pending = new Map<string, number>(); // words in flight -> count
let tickQueued = false;
let lastJoinAttempt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let detailFor: bigint | null = null;
const myMatchIds = new Set<bigint>();
let lastWordKey = "";
let detailHandle: { unsubscribe(): void } | null = null;

function subscribeDetail(c: DbConnection, matchId: bigint) {
  if (detailFor === matchId) return;
  try { detailHandle?.unsubscribe(); } catch {}
  detailFor = matchId;
  const t = Date.now();
  detailHandle = c.subscriptionBuilder()
    .onApplied(() => { log("detail_sub", { matchId, ms: Date.now() - t }); queueTick(); })
    .onError((_ctx: unknown) => say(`detail subscription error for match ${matchId}`))
    .subscribe([
      tables.matchParticipant.where((r) => r.matchId.eq(matchId)),
      tables.auction.where((r) => r.matchId.eq(matchId)),
      tables.auctionResult.where((r) => r.matchId.eq(matchId)),
      tables.wordPlay.where((r) => r.matchId.eq(matchId)),
    ]);
}

function currentMatch(c: DbConnection) {
  if (myBotId === null) return undefined;
  for (const id of myMatchIds) {
    const m = c.db.matchState.id.find(id);
    if (m?.status.tag === "Running") return m;
  }
  return undefined;
}

function serverRack(c: DbConnection, matchId: bigint): Counts {
  const r = emptyCounts();
  for (const h of c.db.myRack.iter()) if (h.matchId === matchId) r[li(h.letter)]! += h.count;
  return r;
}

function buildView(c: DbConnection, matchId: bigint): BotView | undefined {
  const m = c.db.matchState.id.find(matchId);
  if (!m) return undefined;
  const parts = [...c.db.matchParticipant.iter()].filter((p) => p.matchId === matchId).sort((a, b) => (a.id < b.id ? -1 : 1));
  const seatOf = new Map(parts.map((p, i) => [p.botId, i] as const));
  const me = seatOf.get(myBotId!);
  if (me === undefined) return undefined;
  const rack = serverRack(c, matchId);
  let balance = Number(parts[me]!.balance);
  for (const [w, k] of pending) {
    for (let i = 0; i < k; i++) { for (const ch of w) rack[li(ch)]!--; balance += wordReward(w); }
  }
  for (let i = 0; i < 26; i++) if (rack[i]! < 0) rack[i] = 0;
  const history: AuctionRecord[] = [...c.db.auctionResult.iter()]
    .filter((r) => r.matchId === matchId).sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1))
    .map((r, i) => ({ round: i + 1, letter: r.letter, winner: r.winnerBotId != null ? seatOf.get(r.winnerBotId) ?? -1 : -1, paid: Number(r.paid) }));
  const words: WordRecord[] = [...c.db.wordPlay.iter()]
    .filter((w) => w.matchId === matchId).sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((w) => ({ round: 0, seat: seatOf.get(w.botId) ?? -1, word: w.word, reward: Number(w.totalReward) }));
  return {
    round: m.currentRound, bagTotal: m.bagTotal, balance, score: Number(parts[me]!.score), rack, me,
    nPlayers: parts.length, rackSize: m.startingRackSize, auctionType: m.auctionType.tag as BotView["auctionType"],
    players: parts.map((p, i) => ({ seat: i, balance: Number(p.balance), score: Number(p.score) })),
    history, words, rng: Math.random,
  };
}

function queueTick() {
  if (tickQueued) return;
  tickQueued = true;
  setImmediate(() => { tickQueued = false; try { tick(); } catch (e) { say(`tick error: ${errMsg(e)}`); log("tick_error", { err: errMsg(e) }); } });
}

function tick() {
  const c = conn;
  if (!c || myBotId === null) return;
  const m = currentMatch(c);
  if (!m) { maybeJoinLobby(c); return; }
  const matchId = m.id;
  subscribeDetail(c, matchId);
  let inst = instances.get(matchId);
  if (!inst) {
    inst = Champion.create(Date.now());
    instances.set(matchId, inst);
    say(`match ${matchId} running: type=${m.auctionType.tag} rack=${m.startingRackSize} dur=${m.auctionDurationMs}ms bag=${m.bagTotal}`);
    log("match_start", { matchId, auctionType: m.auctionType.tag, rackSize: m.startingRackSize, durMs: m.auctionDurationMs, bagTotal: m.bagTotal,
      players: [...c.db.matchParticipant.iter()].filter((p) => p.matchId === matchId).map((p) => ({ botId: p.botId, name: c.db.bot.id.find(p.botId)?.name })) });
  }
  // 1) words first (server processes our calls in order, so the bid sees the reward)
  const v0 = buildView(c, matchId);
  if (!v0) return;
  const wordKey = `${matchId}|${v0.rack.join(",")}|${v0.bagTotal}|${v0.balance < 12}|${pending.size}`;
  const t0 = performance.now();
  const ws = wordKey === lastWordKey ? [] : inst.chooseWords(v0);
  lastWordKey = wordKey;
  const wordMs = performance.now() - t0;
  for (const w of ws) submitWord(c, matchId, w, v0, wordMs);
  // 2) bid on the open auction once
  const aid = m.currentAuctionId;
  if (aid == null || bidDone.has(aid)) return;
  const a = c.db.auction.id.find(aid);
  if (!a || a.status.tag !== "Open") return;
  bidDone.add(aid);
  const v = buildView(c, matchId)!;
  const t1 = performance.now();
  let amount = Math.floor(inst.decideBid(v, a.letter));
  const decideMs = performance.now() - t1;
  const serverBal = Number([...c.db.matchParticipant.iter()].find((p) => p.matchId === matchId && p.botId === myBotId)!.balance);
  amount = Math.max(0, Math.min(amount, v.balance));
  const lagMs = Date.now() - Number(a.opensAt.microsSinceUnixEpoch / 1000n);
  log("auction", { matchId, aid, letter: a.letter, round: m.currentRound, bagTotal: m.bagTotal, bid: amount, balance: v.balance, serverBal, decideMs: +decideMs.toFixed(1), lagMs, rackSize: v.rack.reduce((x, y) => x + y, 0) });
  if (amount <= 0) return;
  const sent = Date.now();
  const attempt = (amt: number, retry: boolean) => {
    c.reducers.submitBid({ auctionId: aid, amount: BigInt(amt) })
      .then(() => log("bid_ack", { aid, amt, ackMs: Date.now() - sent }))
      .catch((e) => {
        const msg = errMsg(e);
        log("bid_err", { aid, amt, err: msg, ackMs: Date.now() - sent });
        if (retry && /Insufficient/i.test(msg)) {
          const bal = Number([...c.db.matchParticipant.iter()].find((p) => p.matchId === matchId && p.botId === myBotId)?.balance ?? 0);
          if (bal > 0) attempt(Math.min(amt, bal), false);
        }
      });
  };
  attempt(amount, true);
}

function submitWord(c: DbConnection, matchId: bigint, w: string, v: BotView, ms: number) {
  pending.set(w, (pending.get(w) ?? 0) + 1);
  const sent = Date.now();
  log("word_submit", { matchId, word: w, reward: wordReward(w), bagTotal: v.bagTotal, decideMs: +ms.toFixed(1) });
  say(`play ${w} (+${wordReward(w)}) bag=${v.bagTotal}`);
  const done = () => { const k = (pending.get(w) ?? 1) - 1; if (k <= 0) pending.delete(w); else pending.set(w, k); queueTick(); };
  c.reducers.submitWord({ matchId, word: w })
    .then(() => { log("word_ack", { word: w, ackMs: Date.now() - sent }); done(); })
    .catch((e) => { log("word_err", { word: w, err: errMsg(e) }); say(`word ${w} failed: ${errMsg(e)}`); done(); });
}

function maybeJoinLobby(c: DbConnection) {
  if (myBotId === null) return;
  if (matchesDone >= MAX_MATCHES) return;
  if (ENV.LOBBY === "0") return; // tournament-only mode: stay connected, never join the lobby
  const open = [...c.db.openLobbies.iter()][0];
  if (open && [...c.db.openLobbyMembers.iter()].some((lm) => lm.lobbyId === open.id && lm.botId === myBotId)) return;
  if (Date.now() - lastJoinAttempt < 5000) return;
  lastJoinAttempt = Date.now();
  say("joining lobby");
  c.reducers.joinLobby({}).then(() => log("join_lobby", { ok: true })).catch((e) => { log("join_lobby", { err: errMsg(e) }); say(`join failed: ${errMsg(e)}`); });
}

function onMatchEnded(c: DbConnection, matchId: bigint) {
  const parts = [...c.db.matchParticipant.iter()].filter((p) => p.matchId === matchId);
  if (!parts.some((p) => p.botId === myBotId)) return;
  const rows = parts.map((p) => ({ name: c.db.bot.id.find(p.botId)?.name ?? String(p.botId), botId: p.botId, score: Number(p.score), balance: Number(p.balance) }))
    .sort((a, b) => b.score - a.score);
  const mine = rows.find((r) => r.botId === myBotId)!;
  const place = 1 + rows.filter((r) => r.score > mine.score).length;
  const leftover = serverRack(c, matchId).reduce((x, y) => x + y, 0);
  matchesDone++;
  say(`match ${matchId} ENDED: place ${place}/${rows.length} score ${mine.score} leftover ${leftover} | ` + rows.map((r) => `${r.name}:${r.score}`).join(" "));
  log("match_end", { matchId, place, n: rows.length, score: mine.score, leftover, rows });
  instances.delete(matchId);
  pending.clear();
  if (matchesDone >= MAX_MATCHES) { say(`MAX_MATCHES reached; exiting`); setTimeout(() => process.exit(0), 500); return; }
  queueTick();
}

function connect() {
  say(`connecting to ${DB_NAME} at ${HOST}`);
  const token = loadToken();
  if (!token) { console.error("No token: set BOT_TOKEN in .env"); process.exit(1); }
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect((c, identity, tok) => {
      conn = c;
      myIdentity = identity;
      try { fs.writeFileSync(TOKEN_PATH, tok, { mode: 0o600 }); } catch {}
      say(`connected as ${identity.toHexString().slice(0, 12)}…`);
      const tSub = Date.now();
      detailFor = null;
      c.subscriptionBuilder()
        .onApplied(() => {
          myBotId = c.db.botCredential.identity.find(myIdentity!)?.botId ?? null;
          if (myBotId === null) { say("no BotCredential for this token — mint a new one on /team"); process.exit(1); }
          say(`subscribed in ${Date.now() - tSub}ms; acting as bot '${c.db.bot.id.find(myBotId)?.name}' (id ${myBotId})`);
          log("connected", { botId: myBotId, subMs: Date.now() - tSub });
          const me = myBotId;
          c.subscriptionBuilder().onApplied(() => {
            for (const p of c.db.matchParticipant.iter()) if (p.botId === me) myMatchIds.add(p.matchId);
            queueTick();
          }).subscribe([tables.matchParticipant.where((r) => r.botId.eq(me))]);
          if (TOURNAMENT_ID) {
            c.reducers.registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
              .then(() => { say(`registered for tournament ${TOURNAMENT_ID}`); log("tournament_register", { id: TOURNAMENT_ID }); })
              .catch((e) => { say(`tournament register failed: ${errMsg(e)}`); log("tournament_register", { id: TOURNAMENT_ID, err: errMsg(e) }); });
          }
          queueTick();
        })
        .subscribe([tables.bot, tables.botCredential, tables.matchState, tables.openLobbies, tables.openLobbyMembers, tables.myRack]);
      c.db.auction.onInsert(() => queueTick());
      c.db.auction.onUpdate(() => queueTick());
      c.db.myRack.onInsert(() => queueTick());
      c.db.myRack.onUpdate(() => queueTick());
      c.db.myRack.onDelete(() => queueTick());
      // NB: match_state streams every match on the server; only react to ours.
      c.db.openLobbies.onInsert(() => queueTick());
      c.db.openLobbies.onDelete(() => queueTick());
      c.db.openLobbyMembers.onDelete(() => queueTick());

      c.db.matchState.onUpdate((_ctx, old, neu) => {
        if (!myMatchIds.has(neu.id)) return;
        if (old.status.tag !== "Ended" && neu.status.tag === "Ended") onMatchEnded(c, neu.id);
        queueTick();
      });
      c.db.matchParticipant.onInsert((_ctx, p) => { if (p.botId === myBotId) { myMatchIds.add(p.matchId); queueTick(); } });
      c.db.auctionResult.onInsert((_ctx, r) => {
        if (currentMatch(c)?.id !== r.matchId && !instances.has(r.matchId)) return;
        log("result", { matchId: r.matchId, aid: r.auctionId, letter: r.letter, winner: r.winnerBotId, mine: r.winnerBotId === myBotId, paid: r.paid });
      });
      c.db.wordPlay.onInsert((_ctx, w) => {
        if (!instances.has(w.matchId)) return;
        log("word_play", { matchId: w.matchId, botId: w.botId, word: w.word, reward: w.totalReward, mine: w.botId === myBotId });
      });
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => { say(`connect error: ${err.message}`); scheduleReconnect(); })
    .onDisconnect(() => { say("disconnected"); log("disconnected"); conn = null; scheduleReconnect(); })
    .build();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; myBotId = null; connect(); }, 2000);
}

// periodic watchdog: rejoin lobby / pick up missed events
setInterval(() => queueTick(), 2000);
process.on("unhandledRejection", (e) => { say(`unhandled: ${errMsg(e)}`); log("unhandled", { err: errMsg(e) }); });
process.on("uncaughtException", (e) => { say(`uncaught: ${errMsg(e)}`); log("uncaught", { err: errMsg(e) }); });
connect();
