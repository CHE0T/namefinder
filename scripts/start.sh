#!/usr/bin/env bash
# Start domainscraper backend (8001), nameGenerator backend (8002),
# and the unified nameFinder frontend (5175).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAINSCRAPER="$SCRIPT_DIR/../domainscraper"
NAMEGENERATOR="$SCRIPT_DIR/../namegenerator"

kill_port() {
  local port=$1
  local pid
  pid=$(netstat -ano 2>/dev/null | awk "/LISTENING/ && /:${port} /{print \$NF}" | head -1)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "Killing existing process on port $port (PID $pid)..."
    taskkill //PID "$pid" //F > /dev/null 2>&1
    sleep 1
  fi
}

kill_port 8001
kill_port 8002
kill_port 5175

export PATH="/c/Program Files/nodejs:$PATH"

# ── domainscraper backend (8001) ──────────────────────────────────────────────
cd "$DOMAINSCRAPER/backend"
if [ ! -d ".venv" ]; then
  echo "domainscraper: no venv — creating..."
  python -m venv .venv
  .venv/Scripts/pip install -r requirements.txt
fi
echo "Starting domainscraper backend on http://localhost:8001 ..."
.venv/Scripts/python.exe -m uvicorn main:app --port 8001 &
DS_PID=$!

# ── nameGenerator backend (8002) ─────────────────────────────────────────────
cd "$NAMEGENERATOR/backend"
if [ ! -d ".venv" ]; then
  echo "nameGenerator: no venv — creating..."
  python -m venv .venv
  .venv/Scripts/pip install -r requirements.txt
fi
echo "Starting nameGenerator backend on http://localhost:8002 ..."
.venv/Scripts/python.exe -m uvicorn main:app --port 8002 &
NG_PID=$!

# ── nameFinder frontend (5175) ────────────────────────────────────────────────
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "nameFinder: no node_modules — running npm install..."
  npm install
fi
echo "Starting nameFinder frontend on http://localhost:5175 ..."
npm run dev -- --port 5175 &
FE_PID=$!

echo ""
echo "All three processes running:"
echo "  nameFinder  → http://localhost:5175"
echo "  nameGen API → http://localhost:8002"
echo "  domainS API → http://localhost:8001"
echo ""
echo "Press Ctrl+C to stop all."

trap "echo 'Stopping...'; kill $DS_PID $NG_PID $FE_PID 2>/dev/null; exit 0" INT TERM
wait
