# STATUS — dumpling (ScrabbleBot)

Repo: https://github.com/srana3/dumpling-scrabblebot (public, per owner). Bot: `dumpling` (bot id 231).
Run live: `scripts/run-live.sh` (caffeinate + auto-restart). Tournament: `TOURNAMENT_ID=<id> scripts/run-live.sh`.

## Phase
- [x] A Recon — see RECON.md. **Live lobbies are 6 real team bots; market clears at ~10–12/tile.**
- [x] B Simulator (`sim/match.ts`, worker-parallel `sim/run.ts`, ~4k matches/min, CRN seeds, seat rotation) + 7 fidelity tests
- [x] C Zoo (`opponents/zoo.ts`): starter clone, starterGreedy, hoarder, allin, rare, spammer, copycat, jammer, saver, smart, **market/marketHi/marketLive (calibrated to live prices)**. Hold-out: copycat, saver, smart.
- [x] D Champion: partition-DP valuation (κ·face + τ option value), adaptive market-model bid shading, cash recycling, endgame liquidation, final-auction bid 0, solver deadline
- [~] E Red-team — lean (owner asked to save compute): self-play vs white-box clones + param search; no subagent swarm
- [~] F Live — running v2

## Versions
| tag | change | why |
|---|---|---|
| c0 | marginal partition value, κ=2, fixed μ | baseline; crushes sims (1.06) but **won 2 tiles/match live** (place 5/6) |
| c1 | + per-tile enabling value τ, tuned vs `market` rival | sim market field 1.11, but live prices rose → 5th, 6th |
| c2 | + adaptive λ (score-per-coin threshold from paid-stream price model so budget is spent by match end) | live-calibrated field 2.52 → 1.18 |

## Metrics (sim, Vickrey, 6 seats, mean place ± 95% CI)
| hero | field | n | place | win | score |
|---|---|---|---|---|---|
| c0 | 5 server sims | 140 | 1.06 ± 0.05 | 96% | 129 |
| starter clone | 5 server sims | 140 | 2.91 ± 0.12 | 0% | 28 |
| c2 | marketLive×3, market, marketHi | 160 | 1.18 | — | 84 |
| c2 | market×4, marketHi | 160 | 1.11 | — | 97 |
| c2 | marketLive, smart, jammer, Brutus, market | 160 | 1.08 | — | 118 |
| c2 | **hold-out** (copycat/saver/smart + sims) | 300 | 1.00 ± 0 | 100% | 241 |
| c2 | c1 + marketLive×2, market, marketHi | 400 | 1.28 ± 0.06 | h2h vs c1 **0.88** | 86 |
| c2 | c1 + 4 sims | 400 | 1.57 | h2h vs c1 0.43 (c1 hoards harder in cheap markets) | 163 |
| c1 | FirstPrice market field | 300 | 1.50 | 71% | 81 |
| c1 | 4 / 8 players | 300 | 1.55 / 1.88 | 60% / 48% | — |

## Live results
| match | ver | place | score | winner |
|---|---|---|---|---|
| 45629 | c0 | 5/6 | 25 | QuertyBot 127 |
| 45640 | c0 | 5/6 | 17 | Rowin'Boats 132 |
| 45721 | c1 | 5/6 | 33 | N1gel 122 |
| 45733 | c1 | 6/6 | 20 | RackMaw-Blend25 98 |

## Open risks
- Sim rivals are parametric; real top bots are smarter. Live results are the real benchmark.
- Lobby ratings took 4 bad results from c0/c1 → owner may want to **start a new bot version on /team** once c2+ is settled.
- First-price tournaments: shading is a simple 85th-percentile rival estimate; less validated.

## Vulnerabilities found (NOT used)
- `subscribeToAllTables` on the public DB pulls all history (OOM at 3.5 GB) — not a vuln per se, but heavy load on maincloud for any client doing it.
- Nothing exploitable found in reducers (scheduled reducers check `requireScheduler`; bids validated against balance & window).
