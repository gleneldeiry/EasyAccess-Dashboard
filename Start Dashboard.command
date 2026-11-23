#!/bin/zsh
# Double-click to start the EasyAccess dashboard.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
( sleep 1.5 && open "http://localhost:${PORT:-3000}" ) &
npm start
