# nameFinder — Product Requirements Document

## Overview

nameFinder is a unified personal tool that combines two standalone apps into one workflow:

1. **nameGenerator** — generates brand name candidates via the Namelix API
2. **domainSearch** — checks domain availability, pricing, and US trademark status

The goal is a single continuous workflow: generate a large pool of names, then review extensions and price range in the same page without switching modes or copying text manually.

---

## Architecture

```
namefinder/
├── frontend/          ← unified React + Vite app (port 5173)
│   └── src/
│       ├── App.jsx           ← shell, theme toggle
│       ├── Generator.jsx     ← name generation, inline DomainChecker below results
│       └── DomainChecker.jsx ← domain search (standalone + compact/inline mode)
├── PRD.md
```

**Two backends, one frontend.** Backends live in their own repos:

| Service | Folder | Port | Entrypoint |
|---------|--------|------|------------|
| domainscraper backend | `../domainscraper/backend` | 8001 | `main:app` |
| nameGenerator backend | `../namegenerator/backend` | 8002 | `main:app` |
| nameFinder frontend | `./frontend` | 5173 | `npm run dev` |

Vite proxies (no port set in vite.config.js — defaults to 5173):
- `/api/gen/...` → strips prefix → forwards to 8002
- `/api/domain/...` → strips prefix → forwards to 8001

---

## Workflow

The frontend is one continuous view:

1. User enters keywords, optional short description (100–200 chars advised), name style, randomness, and target count
2. Clicks **Find** — names stream in from the Namelix API
3. The domain-review panel appears inline below the names grid and auto-starts checking domains as names arrive
4. User reviews results: Buy Now / Price Inquiry / Unknown / Taken, with trademark status alongside
5. User can delete names (individual or bulk by status). Deleted names are removed from the generator's pool; if generation is still active, it automatically refills to the target count.
6. **Priority Check** — user can type specific names to jump the queue: they are prepended to the generator's name list and domain-checked immediately before the rest.

---

## Features

### Name Generation
- Streams names from Namelix API until target count is reached
- `require_domains: False` — does not pre-filter by .com availability (avoids cheap/low-quality bias)
- Pause/Resume/Stop controls
- Session saved to `ngSession` in localStorage

### Domain Checking
- Runs automatically as names arrive from Generator (auto-search via `initialTerms` prop)
- Does not restart if domain scan is already streaming (guards against mid-flight restarts)
- Uses `skip_domains` to avoid re-checking already-checked domains
- Results: Buy Now (available), Price Inquiry (for_sale), Unknown, Taken
- Trademark check (US federal only) runs automatically for non-taken results
- Price range filter, status filters, sort by price or TM verdict
- Session saved to `dsSession` (LZ-compressed) in localStorage

### Priority Check
- Input field in the form: type one or more names, press Enter or click "Check First"
- Those names are prepended to Generator's `names` list (counts toward target)
- DomainChecker immediately restarts with `[priorityTerms, ...allOtherNames]`
- Deletion works identically to any generated name (same code path)
- While domain checker is paused: priority terms queue up and fire on resume

### Deletion + Auto-refill
- Deleting a domain group removes the base name from Generator's `names` list via `onDeleteBases`
- Deleted entries are also purged from in-flight scan buffers (`flushedRef`, `pendingRef`) so they can't reappear
- If Generator is actively streaming (running or paused) when names are deleted, it aborts and restarts with the updated names list to refill back to target
- No auto-refill if Generator was already stopped or completed

---

## Key settings (defaults)

| Setting | Default |
|---------|---------|
| Name style | Brandable |
| Randomness | Medium |
| Target count | 1,000 |
| Description limit | 300 chars (100–200 advised) |
| TLDs | .com, .ai |
| TLD mode | ALL (domain must be available on all selected TLDs) |
| Price max | $10,000 |

---

## How to run (Windows)

Start each in its own PowerShell window with venv activated:

```powershell
# Domain scraper (port 8001)
cd C:\Users\andre\projects\domainscraper\backend
.\.venv\Scripts\activate
python -m uvicorn main:app --host 127.0.0.1 --port 8001

# Name generator (port 8002)
cd C:\Users\andre\projects\namegenerator\backend
.\.venv\Scripts\activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002

# Frontend
cd C:\Users\andre\projects\namefinder\frontend
npm run dev
```

Opens at **http://localhost:5173**

---

## Sessions

Both components maintain their own `localStorage` sessions independently:
- Generator: key `ngSession`
- DomainChecker: key `dsSession` (LZ-compressed)
- Theme: key `nfTheme`

**Start Over** clears both sessions and reloads the page.

---

## Known gotchas

- **Multiword style returns 0 names** — intentional. All multiword results contain spaces, blocked by `_VALID_NAME = re.compile(r'^[a-z0-9]+')` in namegenerator backend. Domain names can't have spaces.
- **Domain scraper entrypoint is `main:app`** — not `domain_checker:app`. The FastAPI `app` object is in `main.py`.
- **HugeDomains URL format** — must use `.cfm` format: `https://www.hugedomains.com/domain_profile.cfm?d={base}&e={tld}`. The `/domain/{domain}` path returns 403 from Cloudflare.
- **`PORKBUN_SEARCH` in DomainChecker.jsx** — defined but not wired to UI (dead code from original domainscraper). Harmless.
- **Priority check timing** — `submitPriority` fires synchronously before React re-renders, so `initialTermsRef` in DomainChecker may not yet include the new priority names. Priority terms are passed directly, so the scan is correct. A redundant no-op auto-scan may follow (all domains already in skip_domains) — harmless.
- **Deleted-base reappearance** — if a domain result for a deleted base arrives in the pending buffer after deletion but before the flush timer runs, it could reappear. Fixed via `deletedBasesRef` that gates both the 2.5 s flush tick and the stream-end flush.
- **Dead CSS in App.css** — `.nf-tabs`, `.nf-tab`, `.nf-tab--active` are unused leftovers. Harmless.
