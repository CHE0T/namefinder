@echo off
setlocal enabledelayedexpansion

set ROOT=%~dp0..
set DOMAINSCRAPER=%ROOT%\domainscraper
set NAMEGENERATOR=%ROOT%\namegenerator
set FRONTEND=%ROOT%\frontend

:: ── domainscraper backend (8001) ─────────────────────────────────────────────
if not exist "%DOMAINSCRAPER%\.venv" (
    echo domainscraper: creating venv and installing dependencies...
    cd /d "%DOMAINSCRAPER%"
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt
)
echo Starting domainscraper on http://localhost:8001 ...
start "domainscraper" cmd /k "cd /d "%DOMAINSCRAPER%" && .venv\Scripts\python.exe -m uvicorn main:app --port 8001"

:: ── namegenerator backend (8002) ─────────────────────────────────────────────
if not exist "%NAMEGENERATOR%\.venv" (
    echo namegenerator: creating venv and installing dependencies...
    cd /d "%NAMEGENERATOR%"
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt
)
echo Starting namegenerator on http://localhost:8002 ...
start "namegenerator" cmd /k "cd /d "%NAMEGENERATOR%" && .venv\Scripts\python.exe -m uvicorn main:app --port 8002"

:: ── frontend (5173) ──────────────────────────────────────────────────────────
if not exist "%FRONTEND%\node_modules" (
    echo frontend: running npm install...
    cd /d "%FRONTEND%"
    npm install
)
echo Starting frontend on http://localhost:5173 ...
start "frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

echo.
echo nameFinder running at http://localhost:5173
echo Close the three terminal windows to stop.
