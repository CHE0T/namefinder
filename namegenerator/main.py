import asyncio
import json
import random
import re
from typing import AsyncGenerator

_VALID_NAME = re.compile(r'^[a-z0-9]+$')

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

NAMELIX_URL = "https://namelix.com/generate"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://namelix.com",
    "Referer": "https://namelix.com/app/",
}

STYLE_MAP: dict[str, str] = {
    "brandable":    "brandable",
    "evocative":    "wordmix",
    "multiword":    "multiword",
    "shortphrase":  "rhyme",
    "spelling":     "spelling",
    "language":     "language",
    "dictionary":   "dictionary",
}

_ALL_STYLES = list(STYLE_MAP.values())

# search_id → asyncio.Event (set = running, clear = paused)
_pause_events: dict[str, asyncio.Event] = {}

app = FastAPI(title="nameGenerator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


class GenerateRequest(BaseModel):
    keywords: str
    description: str = ""
    style: str = "brandable"
    randomness: str = "medium"
    count: int = 50
    search_id: str = ""
    existing_names: list[str] = []  # names already in the UI — dedup and count toward target

    @field_validator("keywords")
    @classmethod
    def keywords_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("keywords cannot be empty")
        return v.strip()

    @field_validator("style")
    @classmethod
    def style_valid(cls, v: str) -> str:
        if v not in STYLE_MAP and v != "auto":
            raise ValueError(f"style must be one of: auto, {', '.join(sorted(STYLE_MAP))}")
        return v

    @field_validator("randomness")
    @classmethod
    def randomness_valid(cls, v: str) -> str:
        if v not in ("low", "medium", "high"):
            raise ValueError("randomness must be low, medium, or high")
        return v

    @field_validator("count")
    @classmethod
    def count_in_range(cls, v: int) -> int:
        if v < 1:
            raise ValueError("count must be at least 1")
        return v


async def _fetch_page(
    client: httpx.AsyncClient,
    payload: dict,
    page: int,
    max_retries: int = 2,
) -> tuple[list, str | None]:
    """Fetch one page from Namelix with retry on transient errors. Returns (logos, error_msg)."""
    for attempt in range(max_retries + 1):
        try:
            r = await client.post(NAMELIX_URL, json=payload, headers=_HEADERS)
            r.raise_for_status()
            result = r.json()
            return result.get("logos", []), None
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status < 500 or attempt == max_retries:
                return [], f"HTTP {status} on page {page} — {e.response.text[:120]}"
            await asyncio.sleep(1.5)
        except httpx.HTTPError as e:
            if attempt == max_retries:
                return [], f"Network error on page {page}: {e}"
            await asyncio.sleep(1.5)
        except Exception as e:
            return [], f"Unexpected error on page {page}: {e}"
    return [], f"Failed after {max_retries + 1} attempts on page {page}"


async def _stream_names(
    req: GenerateRequest,
    pause_event: asyncio.Event | None,
) -> AsyncGenerator[str, None]:
    api_style = random.choice(_ALL_STYLES) if req.style == "auto" else STYLE_MAP[req.style]
    seed = random.randint(1, 4_294_967_290)

    # Seed state from existing names — they count toward the target and are excluded from output
    names: list[str] = list(req.existing_names)
    seen: set[str] = set(req.existing_names)
    page = 0
    seeds_tried = 1
    MAX_RESEEDS = 10

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        while len(names) < req.count:
            if pause_event is not None:
                await pause_event.wait()

            # Cap prev_names sent to Namelix to avoid oversized payloads;
            # full dedup is handled by our seen set
            payload = {
                "keywords": req.keywords,
                "description": req.description,
                "blacklist": "",
                "max_length": 25,
                "style": api_style,
                "random": req.randomness,
                "extensions": ["com"],
                "require_domains": False,
                "prev_names": names[-150:],
                "prev_references": [],
                "ban_history": [],
                "saved": [],
                "premium_index": 0,
                "page": page,
                "num": 25,
                "seed": seed,
                "category": "",
            }

            logos, err = await _fetch_page(client, payload, page)
            if err:
                yield json.dumps({"error": err}) + "\n"
                break

            if not logos:
                break

            added = 0
            for logo in logos:
                if len(names) >= req.count:
                    break
                raw = (logo.get("businessName") or logo.get("title") or "").strip().lower()
                if not raw or not _VALID_NAME.match(raw):
                    continue
                if raw not in seen:
                    seen.add(raw)
                    names.append(raw)
                    added += 1
                    yield json.dumps({"name": raw}) + "\n"

            if len(names) >= req.count:
                break
            if added == 0:
                if seeds_tried >= MAX_RESEEDS:
                    break
                seed = random.randint(1, 4_294_967_290)
                seeds_tried += 1
                page = 0
                continue

            page += 1
            # Small breathing room between pages — reduces transient errors under rapid requests
            await asyncio.sleep(0.25)

    yield json.dumps({"done": True, "total": len(names)}) + "\n"


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> StreamingResponse:
    event: asyncio.Event | None = None
    if req.search_id:
        event = asyncio.Event()
        event.set()
        _pause_events[req.search_id] = event

    async def _run():
        try:
            async for chunk in _stream_names(req, event):
                yield chunk
        finally:
            _pause_events.pop(req.search_id, None)

    return StreamingResponse(
        _run(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.post("/api/pause/{search_id}")
async def pause_generate(search_id: str):
    ev = _pause_events.get(search_id)
    if ev:
        ev.clear()
    return {"ok": True}


@app.post("/api/resume/{search_id}")
async def resume_generate(search_id: str):
    ev = _pause_events.get(search_id)
    if ev:
        ev.set()
    return {"ok": True}
