#!/bin/zsh
# Keeps dumpling running: no sleep (caffeinate), auto-restart on crash/exit.
#   scripts/run-live.sh                  # lobby ladder
#   TOURNAMENT_ID=<id> scripts/run-live.sh
cd "$(dirname "$0")/.."
export BOT_NAME=${BOT_NAME:-dumpling}
while true; do
  echo "$(date) starting dumpling" >> logs/supervisor.log
  caffeinate -dimsu npx tsx bot/src/index.ts >> logs/console.log 2>&1
  echo "$(date) exited with $? — restarting in 3s" >> logs/supervisor.log
  sleep 3
done
