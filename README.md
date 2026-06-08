# nameFinder

AI-powered startup name generator with live domain availability checking.

---

## Setup (first time only)

### 1. Install these three things

- **Python** — [python.org/downloads](https://www.python.org/downloads/) — click the big yellow Download button, run the installer. **Check the box that says "Add Python to PATH"** before clicking Install.
- **Node.js** — [nodejs.org](https://nodejs.org/) — download the LTS version, run the installer, keep clicking Next.
- **Git** — [git-scm.com/downloads](https://git-scm.com/downloads) — download for your OS, run the installer, keep clicking Next.

### 2. Open a terminal

**Windows:** Press `Win + R`, type `cmd`, press Enter. A black window opens.

**Mac:** Press `Cmd + Space`, type `Terminal`, press Enter.

### 3. Paste these two commands (one at a time, press Enter after each)

```
git clone https://github.com/CHE0T/namefinder.git
```
```
cd namefinder
```

This downloads the project and moves into the folder.

---

## Running the app

### Windows

In File Explorer, open the `namefinder` folder → open `scripts` → double-click `start.bat`.

Three terminal windows will open. The first time it runs it installs dependencies — this takes about a minute. Once you see lines saying things are running, move on.

### Mac / Linux

In the terminal (still in the `namefinder` folder from above), paste:

```
chmod +x scripts/start.sh && ./scripts/start.sh
```

---

## Open the app

Open your browser and go to:

**http://localhost:5173**

---

## Stopping

**Windows:** Close the three terminal windows that opened.

**Mac / Linux:** Press `Ctrl+C` in the terminal.

---

## Running it again later

You don't need to clone or install again. Just:

**Windows:** Open the `namefinder` folder → `scripts` → double-click `start.bat`.

**Mac / Linux:** Open a terminal, `cd` into the `namefinder` folder, run `./scripts/start.sh`.

Then open **http://localhost:5173**.
