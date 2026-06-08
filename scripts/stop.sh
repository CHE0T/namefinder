#!/usr/bin/env bash
for port in 8001 8002 5173; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "Stopping port $port (PID $pid)..."
    kill -9 "$pid" 2>/dev/null
  else
    echo "Nothing on port $port."
  fi
done
echo "Done."
