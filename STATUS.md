# STATUS — dumpling (ScrabbleBot)

Repo: https://github.com/srana3/dumpling-scrabblebot (public, per owner). Bot `dumpling`, bot id 231.
**Current champion: c5** (tag `c5`). Live on this Mac via `scripts/run-live.sh`.

## Tournament checklist
```sh
pkill -f scripts/run-live.sh; pkill -f bot/src/index.ts          # stop ladder play (or let current match finish)
TOURNAMENT_ID=<id> LOBBY=0 nohup scripts/run-live.sh >/dev/null 2>&1 &   # register + stay connected, no lobby
grep -E "registered|ENDED|failed" logs/console.log | tail             # confirm "registered for tournament <id>"
```
- The registration call comes from the bot's own process, on every (re)connect. A repeat call errors harmlessly.
- Keep the Mac plugged in with the lid open. `caffeinate` prevents sleep, and the supervisor restarts the bot on crash.
- The admin's start waits for in-progress matches, so running lobby matches before the start is safe. `LOBBY=0` keeps the bot idle and connected.
- Finals are decided by total score. The bot already maximizes score, so there's no separate mode.

## Phase
- [x] A Recon: RECON.md. Live lobbies are 6 real team bots, and the market clears at about 10–12 per tile.
- [x] B Simulator: `sim/match.ts`, worker-parallel `sim/run.ts` (~4k matches/min), CRN seeds, seat rotation, 7 fidelity tests (`npm test`).
- [x] C Zoo: `opponents/zoo.ts`. 13 bots, including live-calibrated `market`, `marketHi` and `marketLive`. Hold-out: copycat, saver, smart.
- [x] D Champion: `bot/strategy.ts`. Partition-search valuation (κ·face + τ per tile), adaptive market-model λ, cash recycling, endgame liquidation, bid 0 in the final auction, 70–250 ms solver deadline.
- [x] E Red-team, lean (owner: save compute). Five rounds of white-box self-play and parameter search, no subagent swarm. Postmortems 001–002.
- [x] F Live: 33 live matches so far, zero reducer errors, decisions under 3 ms typical.

## Red-team rounds
| round | adversary (angle) | won? | result |
|---|---|---|---|
| live | real lobby field | yes | postmortem 001 → c1, then c2 (adaptive λ) |
| 1 | param search vs c2 clones (d) | yes (h2h 0.78/0.71) | postmortem 002 → c3 |
| 2 | param search vs c3 clones (d) | partial: wins competitive fields 0.65/0.55, loses cheap market 0.36 | combined into round 3 |
| 3 | param search vs c3 incl. cheap-market h2h (d) | partial: 0.66/0.56 competitive, 0.41 cheap | adopted as c5 (live fields are competitive) |
| 4 | endgame-only search: liquidation timing, end κ, end μ, income (b) | **no improvement** | stop signal 1/3 |

The stop condition (3 rounds with no winning adversary) wasn't reached before the freeze.

## Metrics: simulation (Vickrey, 6 seats, 400 matches unless noted, mean place ± 95% CI)
| hero | field | place | h2h | score |
|---|---|---|---|---|
| c0 | 5 server sims (140) | 1.06 ± 0.05 | — | 129 |
| starter clone | 5 server sims (140) | 2.91 ± 0.12 | — | 28 |
| c5 | c3 + 4 sims | 1.59 ± 0.05 | 0.41 vs c3 | 156 |
| c5 | c3×2 + marketLive×2 + marketHi | 1.82 ± 0.10 | 0.66 vs c3 | 78 |
| c5 | c3 + marketLive×2 + market + marketHi | 1.61 ± 0.07 | 0.56 vs c3 | 82 |
| c4≈c5 | c2 (3 fields) | 1.42 / 1.88 / 1.72 | 0.58 / 0.70 / 0.54 | — |
| c4≈c5 | **hold-out zoo** | 1.000 ± 0 | — | 274 |
| c4≈c5 | FirstPrice, market field | 1.72 ± 0.10 | — | 68 |
| c1 | 4 / 8 players | 1.55 / 1.88 | — | — |

## Metrics: live lobby (Vickrey, 6 real bots)
| ver | matches | mean place | wins | mean score | places |
|---|---|---|---|---|---|
| c0 | 2 | 5.00 | 0 | 21 | 5 5 |
| c1 | 2 | 5.50 | 0 | 26 | 5 6 |
| c2 | 9 | 3.33 | 0 | 79 | 4 5 2 3 2 2 3 5 4 |
| c3 | 11 | 3.82 | 2 | 79 | 6 3 1 4 4 5 5 4 6 3 1 |
| c5 | 5+ | 3.80 | 0 | 78 | 3 6 4 4 2 … |

c2, c3 and c5 can't be told apart statistically live (standard error about 0.45 per version). All are far ahead of c0 and c1. Live winners score 85–140, and we score 55–139.

## Open risks
- **Sim-to-live gap:** sim rivals are parametric, while the real top bots (RackMaw-*, Pegasus-*, Lbender, SevenUp) are smarter. Sim gains between c2 and c5 didn't show up live.
- **Ratings:** 4 bad results from c0/c1 are on the ladder. You may want to start a new bot version on /team.
- **Public repo:** rivals can read our parameters. Bids carry ±8% jitter, and the adaptive λ depends on each match's own price stream.
- First-price is validated only in simulation.

## Vulnerabilities found (NOT used)
- None exploitable in reducers. Scheduled reducers check `requireScheduler`, and bids are validated against balance and the auction window.
- `subscribeToAllTables`, which the starter uses, pulls the entire match history (we hit an OOM at 3.5 GB). It's a load issue for maincloud, not a game exploit.
