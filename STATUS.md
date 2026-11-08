# STATUS — dumpling (ScrabbleBot)

## Phase
- [x] A Recon (code read) — live recon pending
- [x] B Simulator v0 (sim/match.ts) — fidelity tests pending
- [x] C Zoo v0 (opponents/zoo.ts)
- [ ] D Champion tuning
- [ ] E Red-team (lean: self-play param search + zoo; no subagent swarm, per owner: save compute)
- [ ] F Live

## Metrics (sim, Vickrey, 6 seats)
| hero | lineup | n | mean place | win | score |
|---|---|---|---|---|---|
| champion v0 | 5 server sims | 140 | 1.057 ± 0.05 | 96.4% | 128.6 |
| starter clone | 5 server sims | 140 | 2.914 ± 0.12 | 0% | 27.5 |

## Vulnerabilities found (NOT used)
- none yet
