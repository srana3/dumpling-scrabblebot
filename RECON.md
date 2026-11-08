# RECON — live vs. brief (Nov 7, ~8:00 PM CT)

Two live lobby matches (45629, 45640) with champion v0, plus a full read of `spacetimedb/src/{game,lobby,index,tournament,letters,dictionary}.ts` and `bot-starter/`.

## Confirmed (matches brief §3)
| Item | Observed |
|---|---|
| Auction type (lobby) | Vickrey (`lobby.auctionType` hardcoded Vickrey in `openLobbyOrCreate`) |
| Auction duration | 1000 ms (`match_state.auction_duration_ms`) |
| Starting rack | 5 tiles (`match_state.starting_rack_size`) |
| bagTotal at first auction | 67 → 68 auctions per 6-seat match; final auction opens with `bagTotal == 0` |
| Unbid tile | discarded (drawn before auction; never returned). **Docs (bot-guide.md) are wrong.** |
| Final-auction tile | unplayable: match ends in the same transaction as the last close |
| Vickrey price | second-highest bid, or `min(1, bid)` for a lone bidder; ties random (shuffle + stable sort) |
| Score | only word rewards; reward also credited to balance |
| Sim bots | Cheapo/Snippet = Cheapskate, Valor/Hagrid = ValueBidder, Brutus/Maverick = Aggressive; bid at auction open; play exactly **one** longest ≥3-letter word (lex-first tie) only after winning |

## Differences / surprises
1. **Live lobbies are full of real team bots, not sims.** Both matches were 6 real bots (match started within ~4 s of joining). Sims only pad on 90 s timeout.
2. **Market prices are ~3.5× face + 3** (second prices): vowels 6–7, D ≈ 8–9, B/C 11–19, W 17–18, K 19, X 31, Z 39. Top bots average 10–12 per tile, win 15–20 tiles, spend ~200 (recycling rewards), finish with ~10–18 balance, score 80–132.
3. Strong rivals play 5–7 letter words mid-game (QUEEN, JERBOA, WINDOWS, KEYCARD, HALOGEN) to recycle cash, then liquidate at the end.
4. If a winner can't pay (`balance < paid`) the tile is silently lost (can't happen with valid bids since balance only drops by paying).
5. Tournament tables can be larger than `matchSize` (leftovers spread across tables). Elimination knocks out last place.
6. Lobby padding timeout is 90 s in code (docs say 60).
7. `subscribeToAllTables` (what the starter does) **OOMs** at 3.5 GB — the DB holds all match history. We subscribe only to `bot, bot_credential, match_state, open_lobbies, open_lobby_members, my_rack`, our `match_participant` rows, and per-match `auction/auction_result/word_play/match_participant`.

## Latency (this Mac → maincloud)
- Auction-open receipt: median ~10 ms after server `opensAt` (clock skew included), max 214 ms.
- Bid ack: median 46 ms, p90 133 ms, max 546 ms. Word ack 64–124 ms.
- Per-match detail subscription applies in 44–180 ms.
- → plenty of slack inside a 1000 ms window; liquidation at `bagTotal <= 2` leaves ≥2 s.

## Results with champion v0 (face-value-ish bidding)
| match | place | score | field |
|---|---|---|---|
| 45629 | 5/6 | 25 | QuertyBot 127, Lbender 97, SevenUp 90, Sigma 26, Cruds 0 |
| 45640 | 5/6 | 17 | Rowin'Boats 132, QuertyBot 106, SevenUp 85, Lbender 80, Sigma 9 |

Root cause: bids of ~2 on vowels vs. market 6–7 → won 2 tiles all match. Fixed in v1 (per-tile enabling value `tau`, money multiplier `mu`, pacing) and a live-calibrated `market` rival added to the zoo.
