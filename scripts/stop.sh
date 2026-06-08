#!/usr/bin/env bash
kill_port() {
  local port=$1
  local pid
  pid=$(netstat -ano 2>/dev/null | awk "/LISTENING/ && /:${port} /{print \$NF}" | head -1)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "Stopping port $port (PID $pid)..."
    taskkill //PID "$pid" //F > /dev/null 2>&1
  else
    echo "Nothing running on port $port."
  fi
}

kill_port 8001
kill_port 8002
kill_port 5175
echo "Done."
