import asyncio
import re
from difflib import SequenceMatcher
import httpx
import wordninja

_MARKBASE_URL = "https://api.markbase.co/search"

# Status codes 600-699 = pending/published (still live, not yet registered)
# Status codes 700-709 = registered and live
# 710+ and 400s = dead/abandoned/cancelled → ignore

def _segment(term: str) -> list[str]:
    return wordninja.split(term.lower())

def _phonetic_swaps(term: str) -> list[str]:
    """
    Generate alternate spellings for the most common phonetic pitfalls in brand names:
      c/k confusion  (combindex ↔ kombindex)
      ph/f confusion (pharmindex ↔ farmindex)
    Applied only to the start of the full combined term to keep query count bounded.
    """
    swaps = []
    if term.startswith('c'):
        swaps.append('k' + term[1:])
    elif term.startswith('k'):
        swaps.append('c' + term[1:])
    if term.startswith('ph'):
        swaps.append('f' + term[2:])
    elif term.startswith('f') and len(term) > 2:
        swaps.append('ph' + term[1:])
    return swaps

def _variants(term: str, components: list[str]) -> list[str]:
    """
    Combined-form variants only. Individual component words are excluded —
    owning "COMB" doesn't block "COMBINDEX"; marks must be judged as a whole.

    For ≥2 components, search both forward AND full-reversed order.
    USPTO precedent holds that reversed marks (COMB INDEX / INDEX COMB) can
    still be confusingly similar.

    Also adds phonetic spelling swaps (c↔k, ph↔f) on the no-space form to
    catch trademarks that sound identical but are spelled differently.
    """
    multi = len(components) > 1
    rev = list(reversed(components))

    candidates = [
        term.lower(),
        " ".join(components) if multi else None,
        "-".join(components) if multi else None,
        "".join(rev) if multi else None,
        " ".join(rev) if multi else None,
        "-".join(rev) if multi else None,
        *_phonetic_swaps(term.lower()),
    ]

    seen = []
    for v in candidates:
        if v and v not in seen:
            seen.append(v)
    return seen

async def _query(client: httpx.AsyncClient, q: str) -> list[dict]:
    try:
        r = await client.get(_MARKBASE_URL, params={"q": q, "limit": 10}, timeout=10.0)
        if r.status_code != 200:
            return []
        return r.json().get("hits", [])
    except Exception:
        return []

def _normalize(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())

def _is_relevant(word_mark: str, term: str, variants: list[str]) -> bool:
    """
    Keep a hit if either:
      1. The word mark's normalized form shares a substring with any variant (exact/near match), OR
      2. Its normalized form is visually similar to the full combined term — catches
         phonetic alternates like COMBINDEKS vs combindex that differ by only a few chars.

    SequenceMatcher ratio ≥ 0.82 ≈ ≤9% character difference, e.g.:
      kombindex vs combindex  → 0.89  ✓ (k/c swap)
      combindeks vs combindex → 0.88  ✓ (x→ks)
      totally unrelated       → ~0.3  ✗
    """
    nm = _normalize(word_mark)
    nt = _normalize(term)

    for v in variants:
        nv = _normalize(v)
        if nv and nv in nm:
            return True

    if nm and nt and SequenceMatcher(None, nm, nt).ratio() >= 0.82:
        return True

    return False

def _verdict_rank(code: int) -> int:
    if 700 <= code <= 709:
        return 2   # registered and live
    if 600 <= code <= 699:
        return 1   # pending/published — still live
    return 0       # dead: abandoned (400s), cancelled (710+), etc.

def _status_label(code: int) -> str:
    known = {
        602: "Suspended",
        686: "Published for Opposition",
        700: "Registered",
        703: "Registered and Renewed",
        710: "Cancelled - Section 8",
    }
    if code in known:
        return known[code]
    if 700 <= code <= 799:
        return "Registered"
    if 600 <= code <= 699:
        return "Pending"
    return f"Status {code}"

async def check_trademark(term: str) -> dict:
    components = _segment(term)
    variants = _variants(term, components)

    async with httpx.AsyncClient() as client:
        all_hits_lists = await asyncio.gather(*[_query(client, v) for v in variants])

    seen: dict[str, dict] = {}
    for hits in all_hits_lists:
        for hit in hits:
            sn = str(hit.get("serial_number", ""))
            if sn and sn not in seen:
                seen[sn] = hit

    live_hits = []
    best_rank = 0
    for hit in seen.values():
        try:
            code = int(hit.get("status_code", 0))
        except (TypeError, ValueError):
            continue
        rank = _verdict_rank(code)
        if rank == 0:
            continue
        if not _is_relevant(hit.get("word_mark") or "", term, variants):
            continue
        live_hits.append({
            "word_mark": hit.get("word_mark", ""),
            "serial_number": str(hit.get("serial_number", "")),
            "status_code": code,
            "status_label": _status_label(code),
            "owner_name": hit.get("owner_name", ""),
            "goods_services": hit.get("goods_services", ""),
            "international_codes": hit.get("international_codes", []),
        })
        if rank > best_rank:
            best_rank = rank

    verdict = {2: "conflict", 1: "review", 0: "clear"}[best_rank]

    return {
        "term": term,
        "verdict": verdict,
        "components": components,
        "variants_searched": variants,
        "hits": live_hits[:10],
    }
