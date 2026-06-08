#!/usr/bin/env bash
# Start domainscraper (port 8001), namegenerator (port 8002), and the frontend (port 5173).
# Works on Mac and Linux. Windows users: use scripts\start.bat instead.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAINSCRAPER="$ROOT/domainscraper"
NAMEGENERATOR="$ROOT/namegenerator"
FRONTEND="$ROOT/frontend"

kill_port() {
  local pid
  pid=$(lsof -ti tcp:"$1" 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "Stopping existing process on port $1..."
    kill -9 "$pid" 2>/dev/null
    sleep 0.5
  fi
}

kill_port 8001
kill_port 8002
kill_port 5173

# ── domainscraper backend (8001) ──────────────────────────────────────────────
cd "$DOMAINSCRAPER"
if [ ! -d ".venv" ]; then
  echo "domainscraper: creating venv and installing dependencies..."
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
echo "Starting domainscraper on http://localhost:8001 ..."
.venv/bin/python -m uvicorn main:app --port 8001 &
DS_PID=$!

# ── namegenerator backend (8002) ──────────────────────────────────────────────
cd "$NAMEGENERATOR"
if [ ! -d ".venv" ]; then
  echo "namegenerator: creating venv and installing dependencies..."
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
echo "Starting namegenerator on http://localhost:8002 ..."
.venv/bin/python -m uvicorn main:app --port 8002 &
NG_PID=$!

# ── frontend (5173) ───────────────────────────────────────────────────────────
cd "$FRONTEND"
if [ ! -d "node_modules" ]; then
  echo "frontend: running npm install..."
  npm install
fi
echo "Starting frontend on http://localhost:5173 ..."
npm run dev &
FE_PID=$!

echo ""
echo "nameFinder running at http://localhost:5173"
echo "Press Ctrl+C to stop."

trap 'echo "Stopping..."; kill $DS_PID $NG_PID $FE_PID 2>/dev/null; exit 0' INT TERM
wait
