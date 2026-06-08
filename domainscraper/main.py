import asyncio
import json
import logging
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from domain_generator import generate_candidates
from domain_checker import check_domains, check_domains_stream, fetch_registration_prices
from trademark_checker import check_trademark

app = FastAPI(title="domainSearch API")

# search_id → asyncio.Event (set = running, clear = paused)
_pause_events: dict[str, asyncio.Event] = {}


@app.on_event("startup")
async def startup():
    await fetch_registration_prices()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    terms: list[str] | None = None
    keywords: list[str] | None = None
    tlds: list[str]
    tld_mode: Literal["or", "and"] = "or"
    search_id: str = ""
    skip_domains: list[str] = []

    @field_validator("terms", "keywords")
    @classmethod
    def terms_not_empty(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        cleaned = [k.strip() for k in v if k.strip()]
        if not cleaned:
            raise ValueError("At least one domain term is required")
        return cleaned

    @field_validator("tlds")
    @classmethod
    def tlds_not_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("At least one TLD is required")
        return v

    @property
    def effective_terms(self) -> list[str]:
        return self.terms or self.keywords or []


class DomainResult(BaseModel):
    domain: str
    status: str
    price: str | None
    purchase_url: str | None


class SearchResponse(BaseModel):
    results: list[DomainResult]


class TrademarkRequest(BaseModel):
    term: str

class TrademarkHit(BaseModel):
    word_mark: str
    serial_number: str
    status_code: int
    status_label: str
    owner_name: str
    goods_services: str = ""
    international_codes: list[str] = []

class TrademarkResponse(BaseModel):
    term: str
    verdict: Literal["clear", "review", "conflict"]
    components: list[str]
    variants_searched: list[str]
    hits: list[TrademarkHit]


@app.post("/api/trademark", response_model=TrademarkResponse)
async def trademark(request: TrademarkRequest) -> TrademarkResponse:
    term = request.term.strip().lower()
    if not term:
        raise HTTPException(status_code=400, detail="term is required")
    result = await check_trademark(term)
    return TrademarkResponse(**result)


@app.post("/api/search/stream")
async def search_stream(request: SearchRequest) -> StreamingResponse:
    terms = request.effective_terms
    all_candidates = generate_candidates(terms, request.tlds)
    if not all_candidates:
        raise HTTPException(status_code=400, detail="No domain candidates could be generated")

    if request.skip_domains:
        skip_set = set(request.skip_domains)
        candidates = [c for c in all_candidates if c not in skip_set]
    else:
        candidates = all_candidates

    if not candidates:
        return StreamingResponse(
            iter([]),
            media_type="application/x-ndjson",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    search_id = request.search_id
    event: asyncio.Event | None = None
    if search_id:
        event = asyncio.Event()
        event.set()  # start unpaused
        _pause_events[search_id] = event

    async def generate():
        try:
            async for result in check_domains_stream(candidates):
                if event is not None:
                    await event.wait()  # blocks here when paused
                yield json.dumps(result) + "\n"
        finally:
            if search_id:
                _pause_events.pop(search_id, None)

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.post("/api/pause/{search_id}")
async def pause_search(search_id: str):
    ev = _pause_events.get(search_id)
    if ev:
        ev.clear()
    return {"ok": True}


@app.post("/api/resume/{search_id}")
async def resume_search(search_id: str):
    ev = _pause_events.get(search_id)
    if ev:
        ev.set()
    return {"ok": True}


@app.post("/api/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    terms = request.effective_terms
    candidates = generate_candidates(terms, request.tlds)

    if not candidates:
        raise HTTPException(status_code=400, detail="No domain candidates could be generated")

    raw_results = await check_domains(candidates)
    results = [DomainResult(**r) for r in raw_results]
    return SearchResponse(results=results)
