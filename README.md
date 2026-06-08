# nameFinder

AI-powered startup name generator with live domain availability checking.

Type a few keywords, get AI-generated name ideas, and instantly see which `.com`, `.io`, `.ai`, etc. domains are available, taken, or for sale — with prices.

---

## Prerequisites

- **Python 3.11+** — [python.org](https://www.python.org/downloads/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **Git** — [git-scm.com](https://git-scm.com/downloads/)

---

## Quick start

### Step 1 — Clone the repo

```bash
git clone https://github.com/CHE0T/namefinder.git
cd namefinder
```

### Step 2 — Start the app

#### Windows

Double-click `scripts\start.bat`.

It will automatically create virtual environments, install all dependencies, and open three terminal windows (one per service). First run takes a minute for installs; subsequent runs are instant.

Open **http://localhost:5173** in your browser.

#### Mac / Linux

```bash
chmod +x scripts/start.sh
./scripts/start.sh
```

Open **http://localhost:5173** in your browser.

---

## Manual setup (if the scripts don't work)

The app is three processes. Run each in a separate terminal:

**1. Domain checker backend (port 8001)**
```bash
cd domainscraper
python3 -m venv .venv

# Windows:
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --port 8001

# Mac / Linux:
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --port 8001
```

**2. Name generator backend (port 8002)**
```bash
cd namegenerator
python3 -m venv .venv

# Windows:
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --port 8002

# Mac / Linux:
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --port 8002
```

**3. Frontend (port 5173)**
```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173**.

---

## How it works

```
Browser (localhost:5173)
    │
    ├─ /api/gen/*    → Vite proxy → namegenerator  (localhost:8002)
    └─ /api/domain/* → Vite proxy → domainscraper  (localhost:8001)
```

- **namegenerator**: calls the Claude API to generate startup name ideas from your keywords
- **domainscraper**: checks domain availability via RDAP/WHOIS, detects parking pages, identifies aftermarket listings (GoDaddy/Afternic, HugeDomains, Spaceship, etc.)
- **frontend**: React + Vite, streams results live as they come in, saves session to localStorage

---

## Stopping

**Windows:** Close the three terminal windows, or run `scripts\stop.bat` (if present).

**Mac / Linux:** Press `Ctrl+C` in the terminal running `start.sh`.
