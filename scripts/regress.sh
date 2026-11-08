#!/bin/zsh
# usage: scripts/regress.sh <candidate-params.json> <prev1.json> [prev2.json ...]   (prev = hall of fame)
cd "$(dirname "$0")/.."
CAND=$(tr -d '\n' < $1); shift
run() { npx tsx sim/run.ts --hero champion --params "$CAND" --lineup "$1" --rparams "$2" --type "${3:-Vickrey}" --n ${N:-400} --workers 6 | python3 -c "import json,sys;r=json.load(sys.stdin);print(f\"{r['job']['lineup'][:46]:46} {r['job']['type'][:5]} place {r['place']:.3f}±{r['placeCI']:.3f} h2h {r.get('h2h')} score {r['score']} rival {r.get('rivalScore')}\")"; }
for P in "$@"; do
  RP=$(python3 -c "import json;d=json.load(open('$P'));d.setdefault('adaptive',0);print(json.dumps(d))")
  echo "== vs $P"
  run "h2h:champion2" "$RP"
  run "field:champion2,champion2,marketLive,marketLive,marketHi" "$RP"
  run "field:champion2,marketLive,marketLive,market,marketHi" "$RP"
done
echo "== hold-out / first-price"
run holdout "{}"
run "field:marketLive,marketLive,marketLive,market,marketHi" "{}" FirstPrice
