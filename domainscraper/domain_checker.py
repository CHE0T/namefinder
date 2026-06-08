import asyncio
import logging
import re
import socket

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_PORKBUN_PRICING_URL = "https://porkbun.com/products/domains"
_PORKBUN_BUY_URL = "https://porkbun.com/checkout/search?q={domain}"
_SEDO_URL = "https://sedo.com/search/?keyword={domain}"

# Nameserver fragments → purchase URL template.
# Checked against RDAP/WHOIS nameserver records (zero extra HTTP requests).
# Covers the major parking/aftermarket platforms by their NS hostnames.
_GODADDY_URL = "https://www.godaddy.com/domainsearch/find?domainToCheck={domain}"

# ── HugeDomains URL resilience ────────────────────────────────────────────────
# HugeDomains occasionally changes which URL path their domain profile pages live at.
# We keep a ranked list of candidates and cache the first one that returns a valid page.
_HD_URL_CANDIDATES: list[str] = [
    "https://www.hugedomains.com/domain_profile.cfm?d={base}&e={tld}",
    "https://www.hugedomains.com/domain/{domain}",
]
_hd_url_tpl: str = _HD_URL_CANDIDATES[0]


def _hd_purchase_url(domain: str) -> str:
    """Build a HugeDomains purchase URL using the current known-good format."""
    base, _, tld = domain.rpartition(".")
    return _hd_url_tpl.format(domain=domain, base=base, tld=tld)


async def _probe_hd_format(client: httpx.AsyncClient, domain: str) -> bool:
    """Try each candidate URL format; update _hd_url_tpl to the first that returns a valid page.
    Returns True if any format works."""
    global _hd_url_tpl
    base, _, tld = domain.rpartition(".")
    for candidate in _HD_URL_CANDIDATES:
        url = candidate.format(domain=domain, base=base, tld=tld)
        try:
            r = await client.get(url, headers=_BROWSER_HEADERS, timeout=10)
            if r.status_code == 200 and "hugedomains" in r.text.lower()[:2000]:
                if _hd_url_tpl != candidate:
                    logger.warning("HugeDomains URL format changed — now using: %s", candidate)
                    _hd_url_tpl = candidate
                return True
        except Exception:
            continue
    logger.error("No working HugeDomains URL format found (tried %d formats)", len(_HD_URL_CANDIDATES))
    return False


_PARKING_NAMESERVERS: dict[str, str] = {
    "domaincontrol.com":  _GODADDY_URL,          # GoDaddy / Afternic
    "afternic.com":       _GODADDY_URL,          # Afternic own nameservers (ns1/ns2.afternic.com)
    "parkingcrew.net":    _GODADDY_URL,          # ParkingCrew → feeds Afternic
    "spaceship.net":      "https://www.spaceship.com/domain-search/?query={domain}&beast=false&tab=domains",
    "hugedomains.com":    _HD_URL_CANDIDATES[0],  # resolved dynamically in _parking_ns_url
    "hugedomainsdns.com": _HD_URL_CANDIDATES[0],  # resolved dynamically in _parking_ns_url
    "bodis.com":          _GODADDY_URL,          # Bodis → Afternic network
    "above.com":          _GODADDY_URL,          # Above.com Premium
    "sedo.com":           "https://sedo.com/search/?keyword={domain}",
    "sedoparking.com":    "https://sedo.com/search/?keyword={domain}",
    "buydomains.com":     "https://www.buydomains.com/{domain}",
    "uniregistry.com":    _GODADDY_URL,          # Uniregistry → GoDaddy
    "namedrive.com":      _GODADDY_URL,
    "namefind.com":       _GODADDY_URL,          # Web.com/NameFind → GoDaddy/Afternic network
    "dan.com":            _GODADDY_URL,          # Dan.com → Afternic
    "squadhelp.com":      "https://www.squadhelp.com/domain-name/{domain}",
    "brandbucket.com":    "https://www.brandbucket.com/names/{base}",
    "eftydns.com":        "http://{domain}",               # Efty — lander IS the purchase page
    "dyna-ns.net":        "https://forsale.dynadot.com/{domain}",  # Dynadot for-sale lander
    "gofruits.co":        "https://www.fruits.co/en/domain/{domain}",  # Fruits.co marketplace
}

_PARKING_SIGNALS = [
    "af-lander",               # Afternic/GoDaddy lander CSS class
    "cashparking.com",         # GoDaddy parking server
    "parkingcrew.net",
    "sedoparking.com",
    "sedo.com",                # Sedo lander — use full domain, not bare "sedo" (matches in JS)
    "afternic.com",
    "afternic",
    "dan.com",
    "premium lander",          # GoDaddy premium lander CSS/text
    "hugedomains.com",
    "buydomains.com",
    "bodis.com",
    "above.com",
    "squadhelp.com",
    "brandbucket.com",
    "domains.atom.com",        # Atom/Epik domain marketplace
    "forsale.dynadot.com",     # Dynadot for-sale lander
    "parking-lander",          # GoDaddy/Web.com JS parking lander bundle path
    "spaceship-cdn.com",       # Spaceship (GoDaddy brand) CDN
    "forsale.spaceship",       # Spaceship for-sale lander
    "domain is for sale",
    "this domain is for sale",
    "buy this domain",
    "purchase this domain",
]

_PARKING_TITLE_RE = re.compile(
    r'\bfor\s+sale\b|buy this domain|domain for sale|buy the domain',
    re.IGNORECASE,
)

# Hedged / uncertain "may be for sale" phrasing — owner might sell but no active listing.
_UNCERTAIN_TITLE_RE = re.compile(
    r'\b(?:may|might)\s+be\s+for\s+sale\b',
    re.IGNORECASE,
)

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Cached at startup via fetch_registration_prices(); fallback if fetch fails
_STANDARD_PRICES: dict[str, str] = {
    "com": "$11/yr",
    "net": "$13/yr",
    "org": "$8/yr",
    "ai":  "$83/yr",
    "io":  "$28/yr",
    "co":  "$10/yr",
    "app": "$11/yr",
    "dev": "$11/yr",
}


def _parse_porkbun_prices(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "lxml")
    prices: dict[str, str] = {}
    for row in soup.find_all("div", class_="row"):
        tld_div = row.find("div", class_="col-xs-3")
        if not tld_div:
            continue
        a = tld_div.find("a", href=re.compile(r"^/tld/"))
        if not a:
            continue
        tld = a.get_text(strip=True).lstrip(".")
        reg_div = row.find("div", class_="registration")
        if not reg_div:
            continue
        price_span = reg_div.find("span", class_="sortValue")
        if price_span:
            prices[tld] = f"${price_span.get_text(strip=True)}/yr"
    return prices


async def fetch_registration_prices() -> None:
    """Fetch live prices from Porkbun and update _STANDARD_PRICES in place."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(_PORKBUN_PRICING_URL, headers=_BROWSER_HEADERS, timeout=15)
            r.raise_for_status()
        prices = _parse_porkbun_prices(r.text)
        if prices:
            _STANDARD_PRICES.update(prices)
            logger.info("Porkbun prices loaded for %d TLDs", len(prices))
        else:
            logger.warning("Porkbun price scrape returned empty — using fallback prices")
    except Exception as exc:
        logger.warning("Could not fetch Porkbun prices (%s) — using fallback prices", exc)

_RDAP_REGISTRY: dict[str, str] = {
    "com": "https://rdap.verisign.com/com/v1/domain/{domain}",
    "net": "https://rdap.verisign.com/net/v1/domain/{domain}",
    "org": "https://rdap.publicinterestregistry.org/rdap/domain/{domain}",
    "app": "https://pubapi.registry.google/rdap/domain/{domain}",
    "dev": "https://pubapi.registry.google/rdap/domain/{domain}",
    "ai":  "https://rdap.nic.ai/domain/{domain}",
}

# TLDs with no public RDAP — checked via WHOIS socket queries.
# Also used as a fallback when RDAP fails twice for TLDs that do have RDAP (e.g. .ai).
_WHOIS_SERVERS: dict[str, str] = {
    "io": "whois.nic.io",
    "co": "whois.registry.co",
    "ai": "whois.nic.ai",
}



def _parking_ns_url(nameservers: list[str], domain: str) -> str | None:
    """Return the marketplace purchase URL if any nameserver matches a known parking service."""
    base, _, tld = domain.rpartition(".")
    for ns in nameservers:
        ns_lower = ns.lower()
        for marker, url_tpl in _PARKING_NAMESERVERS.items():
            if marker in ns_lower:
                if "hugedomains" in marker:
                    return _hd_purchase_url(domain)
                return url_tpl.format(domain=domain, base=base, tld=tld)
    return None


def _result(domain: str, status: str, price: str | None = None, purchase_url: str | None = None) -> dict:
    return {"domain": domain, "status": status, "price": price, "purchase_url": purchase_url}


# ── Availability (RDAP / WHOIS) ───────────────────────────────────────────────

async def _rdap_query(client: httpx.AsyncClient, domain: str, url: str) -> tuple[str, str | None]:
    """Single RDAP attempt. Returns ('available'/'registered'/'error', parking_url)."""
    try:
        r = await client.get(url, timeout=10)
    except Exception as exc:
        logger.warning("[%s] RDAP error: %s", domain, exc)
        return "error", None

    logger.info("[%s] RDAP HTTP %s", domain, r.status_code)

    if r.status_code == 404:
        return "available", None

    # 429 = rate limited, 5xx = server error — transient, don't treat as registered
    if r.status_code == 429 or r.status_code >= 500:
        logger.warning("[%s] RDAP transient status %s", domain, r.status_code)
        return "error", None

    parking_url = None
    try:
        data = r.json()
        nameservers = [ns.get("ldhName", "") for ns in data.get("nameservers", [])]
        parking_url = _parking_ns_url(nameservers, domain)
    except Exception:
        pass

    logger.info("[%s] RDAP registered, parking_ns=%s", domain, parking_url is not None)
    return "registered", parking_url


async def _check_availability(client: httpx.AsyncClient, domain: str) -> tuple[str, str | None]:
    """Returns ('available'/'registered', parking_url_or_None).
    parking_url is non-None when nameservers match a known parking service.
    Prefers RDAP over WHOIS for all supported TLDs; retries once on transient errors."""
    tld = domain.rsplit(".", 1)[-1].lower()

    rdap_template = _RDAP_REGISTRY.get(tld)
    if rdap_template:
        url = rdap_template.format(domain=domain)
        logger.info("[%s] RDAP %s", domain, url)
        status, parking_url = await _rdap_query(client, domain, url)
        if status != "error":
            return status, parking_url
        # Retry once after brief pause
        logger.info("[%s] RDAP retry after transient error", domain)
        await asyncio.sleep(1.0)
        status, parking_url = await _rdap_query(client, domain, url)
        if status != "error":
            return status, parking_url
        # Both attempts failed — fall through to WHOIS if available, else registered
        logger.warning("[%s] RDAP failed twice, falling back", domain)
        if tld not in _WHOIS_SERVERS:
            return "registered", None

    if tld not in _WHOIS_SERVERS:
        logger.warning("[%s] No registry known for .%s", domain, tld)
        return "registered", None

    return await _whois_check(domain, tld)


async def _whois_check(domain: str, tld: str) -> tuple[str, str | None]:
    server = _WHOIS_SERVERS[tld]
    logger.info("[%s] WHOIS %s", domain, server)
    try:
        raw = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _whois_query, domain, server),
            timeout=15,
        )
    except Exception as exc:
        logger.warning("[%s] WHOIS error: %s", domain, exc)
        return "registered", None

    lower = raw.lower()
    is_available = bool(re.search(
        r"no match|not found|no entries found|object does not exist|domain not found|no data found",
        lower,
    ))
    nameservers = re.findall(r"name\s*server[:\s]+(\S+)", lower)
    parking_url = _parking_ns_url(nameservers, domain)
    return ("available" if is_available else "registered"), parking_url


def _whois_query(domain: str, server: str) -> str:
    with socket.create_connection((server, 43), timeout=10) as s:
        s.sendall(f"{domain}\r\n".encode())
        chunks = []
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode(errors="replace")


# ── Parking page price parser (shared) ───────────────────────────────────────

def _parse_parking_price(html: str) -> str | None:
    """Extract an asking price from a parking/for-sale landing page."""
    patterns = [
        r'\$([\d,]+(?:\.\d{2})?)',
        r'USD\s*([\d,]+)',
        r'([\d,]+)\s*USD',
    ]
    for pattern in patterns:
        m = re.search(pattern, html, re.IGNORECASE)
        if m:
            # Strip commas only from the integer part (split off cents first to avoid
            # "$2,923.00" being misread as 292300 if we naively strip all non-digits)
            int_part = m.group(1).split('.')[0].replace(',', '')
            try:
                val = int(int_part)
                if 100 <= val <= 10_000_000:
                    return f"${val:,}"  # normalize to $X,XXX so frontend parsePrice() can parse it
            except ValueError:
                continue
    return None


# ── Sedo aftermarket scraping ─────────────────────────────────────────────────

async def _check_sedo(client: httpx.AsyncClient, domain: str) -> dict:
    """Check Sedo for aftermarket listing. Returns for_sale+price, unknown, or taken."""
    url = _SEDO_URL.format(domain=domain)
    logger.info("[%s] Sedo GET %s", domain, url)
    try:
        r = await client.get(url, headers=_BROWSER_HEADERS, timeout=15, follow_redirects=True)
    except httpx.HTTPError as exc:
        logger.warning("[%s] Sedo error: %s", domain, exc)
        return _result(domain, "taken")

    logger.info("[%s] Sedo HTTP %s", domain, r.status_code)
    logger.debug("[%s] Sedo body snippet: %s", domain, r.text[:800])

    if r.status_code != 200:
        return _result(domain, "taken")

    # Sedo migrated to a React SPA. The static HTML is just <div id="app"></div>
    # with no domain data — we can't tell if the domain is listed or not.
    # Return unknown (with Sedo URL) so the user can verify manually.
    if '<div id="app">' in r.text:
        logger.info("[%s] Sedo: JS-rendered shell detected — cannot determine listing status", domain)
        return _result(domain, "unknown", purchase_url=url)

    price = _parse_sedo_price(r.text, domain)
    if price is not None:
        return _result(domain, "for_sale", price=price, purchase_url=url)
    return _result(domain, "taken")


def _parse_sedo_price(html: str, domain: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")

    text = soup.get_text(" ", strip=True)
    if re.search(r"not (for sale|listed|available)|domain.*not.*listed", text, re.IGNORECASE):
        logger.info("[%s] Sedo: not listed", domain)
        return None

    price = _parse_parking_price(html)
    if price:
        logger.info("[%s] Sedo price found: %s", domain, price)
        return price

    for tag in soup.find_all(True):
        cls = " ".join(tag.get("class", []))
        if re.search(r"price|amount|cost|value", cls, re.IGNORECASE):
            candidate = tag.get_text(strip=True)
            if re.search(r'[\d,]{2,}', candidate):
                logger.info("[%s] Sedo price element: %s", domain, candidate)
                return candidate

    logger.info("[%s] Sedo: listed page but no price found — body: %s", domain, html[:400])
    return None


# ── HugeDomains profile scraper ──────────────────────────────────────────────

async def _fetch_hugedomains_price(client: httpx.AsyncClient, domain: str) -> str | None:
    """Fetch the buy-now price from the HugeDomains domain page.
    Targets <span class='big-text green'> which is the buy-now price in the sidebar.
    Avoids the related-domains section that shows other domains' prices.
    Auto-detects working URL format if the cached one stops returning HTTP 200."""
    url = _hd_purchase_url(domain)
    try:
        r = await client.get(url, headers=_BROWSER_HEADERS, timeout=15)
    except Exception as exc:
        logger.warning("[%s] HugeDomains price fetch error: %s", domain, exc)
        return None
    if r.status_code != 200:
        logger.warning("[%s] HugeDomains returned %d — probing for working URL format", domain, r.status_code)
        if not await _probe_hd_format(client, domain):
            return None
        url = _hd_purchase_url(domain)
        try:
            r = await client.get(url, headers=_BROWSER_HEADERS, timeout=15)
        except Exception as exc:
            logger.warning("[%s] HugeDomains price fetch retry error: %s", domain, exc)
            return None
        if r.status_code != 200:
            return None
    soup = BeautifulSoup(r.text, "lxml")
    el = soup.find("span", class_="big-text")
    if el:
        m = re.search(r'\$([\d,]+)', el.get_text())
        if m:
            return m.group(0)
    return None


# ── HTTP parking page probe ───────────────────────────────────────────────────

async def _check_parking_page(client: httpx.AsyncClient, domain: str, timeout: float | httpx.Timeout = 3.0, *, known_parking_ns: bool = False) -> tuple[dict, bool]:
    """Visit http://{domain} to detect parking/for-sale landing pages.
    Returns (result, http_ok) where http_ok=True means we got HTTP 200 and read the page.
    When http_ok=False the caller should fall back to nameserver-based signals if available.
    known_parking_ns: True when the domain's NS matched a known parking service."""
    import time
    url = f"http://{domain}"
    logger.info("[%s] Parking page GET %s (timeout=%s)", domain, url, timeout)
    t0 = time.monotonic()
    try:
        r = await client.get(url, timeout=timeout, follow_redirects=True)
        elapsed = time.monotonic() - t0
        logger.info("[%s] Parking page responded in %.2fs", domain, elapsed)
    except Exception as exc:
        elapsed = time.monotonic() - t0
        exc_str = str(exc)
        # SSL cert verification can fail when a proxy (e.g. Zscaler) intercepts the HTTPS
        # redirect. These are public parking landers — retry without verification.
        if "CERTIFICATE_VERIFY_FAILED" in exc_str or "certificate_verify_failed" in exc_str.lower():
            logger.info("[%s] SSL cert error — retrying probe with verify=False", domain)
            try:
                async with httpx.AsyncClient(follow_redirects=True, verify=False) as no_ssl_client:
                    r = await no_ssl_client.get(url, timeout=timeout)
                elapsed = time.monotonic() - t0
                logger.info("[%s] Parking page (no-SSL) responded in %.2fs", domain, elapsed)
            except Exception as exc2:
                logger.info("[%s] Parking page error (no-SSL) after %.2fs: %s", domain, elapsed, exc2)
                return _result(domain, "taken"), False
        else:
            logger.info("[%s] Parking page error after %.2fs: %s", domain, elapsed, exc)
            return _result(domain, "taken"), False

    if r.status_code != 200:
        return _result(domain, "taken"), False

    text = r.text
    lower_text = text.lower()

    # Detect JS-only redirect pages (e.g. Afternic landers that do window.location.href="/lander").
    # The static HTML is too small to contain signals; follow the redirect manually.
    if len(text) < 600:
        js_redirect = re.search(r'window\.location(?:\.href)?\s*=\s*["\']([^"\']+)["\']', text)
        if js_redirect:
            redirect_path = js_redirect.group(1)
            redirect_url = redirect_path if redirect_path.startswith("http") else f"http://{domain}{redirect_path}"
            logger.info("[%s] JS redirect detected → following %s", domain, redirect_url)
            try:
                r2 = await client.get(redirect_url, timeout=5.0, follow_redirects=True)
                if r2.status_code == 200:
                    text = r2.text
                    lower_text = text.lower()
                    r = r2  # capture final URL so str(r.url) reflects where we actually landed
                else:
                    return _result(domain, "taken"), False
            except Exception as exc:
                logger.info("[%s] JS redirect follow error: %s", domain, exc)
                return _result(domain, "taken"), False

    is_parking = any(sig in lower_text for sig in _PARKING_SIGNALS)

    if not is_parking:
        soup = BeautifulSoup(text, "lxml")
        title = (soup.title.string or "") if soup.title else ""
        if _PARKING_TITLE_RE.search(title):
            if _UNCERTAIN_TITLE_RE.search(title):
                if known_parking_ns:
                    # Known marketplace NS but page has no body signals — not an active listing
                    logger.info("[%s] Parking: uncertain title + known NS — marking taken", domain)
                    return _result(domain, "taken"), True
                logger.info("[%s] Parking: uncertain title, no known NS — marking unknown", domain)
                return _result(domain, "unknown", purchase_url=f"http://{domain}"), True
            is_parking = True

    if not is_parking:
        logger.info("[%s] Parking: no signals found", domain)
        return _result(domain, "taken"), True  # http_ok=True — we read the page, nothing there

    if "afternic" in lower_text or "af-lander" in lower_text or "cashparking" in lower_text:
        final_url = str(r.url)
        if "afternic.com" in final_url:
            # The TDFS redirect URL serves a stripped parking page, not the real listing.
            # Fetch the canonical Afternic listing URL directly to check whether the domain
            # is actively for sale. Active listings have "for sale" in the page title.
            canonical = f"https://www.afternic.com/forsale/{domain}"
            try:
                r_check = await client.get(canonical, headers=_BROWSER_HEADERS, timeout=8)
                check_title = (BeautifulSoup(r_check.text, "lxml").title.string or "").lower()
            except Exception:
                check_title = ""
            if "for sale" in check_title:
                purchase_url = _GODADDY_URL.format(domain=domain)
                logger.info("[%s] Afternic: active listing confirmed (title=%r)", domain, check_title[:60])
            else:
                logger.info("[%s] Afternic: no active listing (title=%r) — marking unknown", domain, check_title[:60])
                return _result(domain, "unknown", purchase_url=_GODADDY_URL.format(domain=domain)), True
        else:
            purchase_url = _GODADDY_URL.format(domain=domain)
        price = None  # Afternic/GoDaddy loads actual price via API — not in static HTML
    elif "parking-lander" in lower_text:
        purchase_url = _GODADDY_URL.format(domain=domain)
        # LANDER_SYSTEM=PW means parked on GoDaddy but may or may not be listed on Afternic.
        # Check the canonical Afternic page: "for sale" in title = active listing → for_sale;
        # no match = just parked, owner not selling → taken.
        if '"PW"' in text or "'PW'" in text:
            canonical = f"https://www.afternic.com/forsale/{domain}"
            try:
                r_pw = await client.get(canonical, headers=_BROWSER_HEADERS, timeout=8)
                pw_title = (BeautifulSoup(r_pw.text, "lxml").title.string or "").lower()
            except Exception:
                pw_title = ""
            if "for sale" in pw_title:
                logger.info("[%s] parking-lander PW: Afternic listing confirmed — marking for_sale", domain)
                return _result(domain, "for_sale", purchase_url=purchase_url), True
            if not pw_title:
                # Afternic check failed (network error/timeout) — don't risk false taken
                logger.info("[%s] parking-lander PW: Afternic check failed — marking unknown", domain)
                return _result(domain, "unknown", purchase_url=purchase_url), True
            logger.info("[%s] parking-lander PW: not on Afternic (title=%r) — marking taken", domain, pw_title[:60])
            return _result(domain, "taken"), True
        price = None
    elif "spaceship" in lower_text:
        purchase_url = f"https://www.spaceship.com/domain-search/?query={domain}&beast=false&tab=domains"
        price = _parse_parking_price(text)
    elif "hugedomains" in lower_text:
        purchase_url = _hd_purchase_url(domain)
        # Lander page shows installment prices; profile page has the real buy-now price
        price = await _fetch_hugedomains_price(client, domain)
    elif "domains.atom.com" in lower_text:
        purchase_url = str(r.url)           # Atom/Epik — use the final redirect URL directly
        price = _parse_parking_price(text)
    elif "forsale.dynadot.com" in lower_text:
        purchase_url = f"https://forsale.dynadot.com/{domain}"
        price = _parse_parking_price(text)
    elif "sedo.com" in lower_text or "sedoparking.com" in lower_text:
        # Sedo parking page detected. Sedo is fully JS-rendered — we cannot tell from the
        # static lander whether the domain is actively listed for sale or just parked for
        # traffic revenue. Return unknown so the user can verify on Sedo directly.
        purchase_url = _SEDO_URL.format(domain=domain)
        logger.info("[%s] Sedo parking detected — cannot verify listing status (JS-only)", domain)
        return _result(domain, "unknown", purchase_url=purchase_url), True
    else:
        purchase_url = f"http://{domain}"   # unknown marketplace — lander is the purchase page
        price = _parse_parking_price(text)

    logger.info("[%s] Parking: for_sale price=%s url=%s", domain, price, purchase_url)
    return _result(domain, "for_sale", price=price, purchase_url=purchase_url), True


# ── Main entry point ──────────────────────────────────────────────────────────

async def check_domain(client: httpx.AsyncClient, domain: str) -> dict:
    tld = domain.rsplit(".", 1)[-1].lower()
    availability, parking_url = await _check_availability(client, domain)

    if availability == "available":
        price = _STANDARD_PRICES.get(tld)
        return _result(domain, "available", price=price, purchase_url=_PORKBUN_BUY_URL.format(domain=domain))

    if parking_url:
        # HugeDomains: skip the lander probe — fetch price from profile page directly.
        # Landers show installment amounts, not the real buy-now price.
        if "hugedomains.com" in parking_url:
            price = await _fetch_hugedomains_price(client, domain)
            return _result(domain, "for_sale", price=price, purchase_url=parking_url)

        # BrandBucket: no HTTP server — probe always times out. Trust NS directly.
        # Fruits.co: JS-rendered marketplace — price from static HTML is unreliable. Trust NS directly.
        if "brandbucket.com" in parking_url or "fruits.co" in parking_url:
            return _result(domain, "for_sale", purchase_url=parking_url)

        # BuyDomains: Cloudflare 403 blocks probing and the site is a JS SPA so we cannot
        # confirm whether the domain is actively listed. NS match means it *may* be for sale
        # but listings expire and parked-only domains use the same NS. Return unknown so the
        # user can verify manually rather than showing a confident "Price Inquiry" that 404s.
        if "buydomains.com" in parking_url:
            return _result(domain, "unknown", purchase_url=parking_url)

        # Other parking services: run HTTP probe to confirm and pick up price.
        # Real landers (SquadHelp, BuyDomains, Afternic) all respond in < 0.5s from timing data.
        # 3s timeout has 6x headroom; anything not responding by then has no web server.
        # - Probe finds for_sale  → return probe result (most specific)
        # - Probe read the page (http_ok) but found no signals → mark taken
        #   (avoids false positives where a real website uses GoDaddy DNS)
        # - Probe timed out → retry once with connect=2s/read=8s before giving up
        probe, http_ok = await _check_parking_page(client, domain, timeout=3.0, known_parking_ns=True)
        if probe["status"] in ("for_sale", "unknown"):
            # If the probe fell to the else-branch (generic http://{domain} URL) but the NS
            # detection gave us a specific marketplace URL, prefer the NS URL.
            generic_url = f"http://{domain}"
            if probe["purchase_url"] == generic_url and parking_url and parking_url != generic_url:
                probe = {**probe, "purchase_url": parking_url}
            return probe
        if http_ok:
            logger.info("[%s] Parking NS matched but probe read page with no signals — marking taken", domain)
            return _result(domain, "taken")
        # First probe timed out/errored — retry with split connect/read timeouts:
        # connect=3s catches "no web server" fast; read=10s handles slow-but-real landers.
        logger.info("[%s] Probe timed out, retrying (connect=2s, read=8s)", domain)
        await asyncio.sleep(1.0)
        probe, http_ok = await _check_parking_page(client, domain, timeout=httpx.Timeout(connect=2.0, read=8.0, write=5.0, pool=5.0), known_parking_ns=True)
        if probe["status"] == "for_sale":
            return probe
        if http_ok:
            logger.info("[%s] Retry probe read page with no signals — marking taken", domain)
            return _result(domain, "taken")
        # Both probes timed out. For GoDaddy-parked domains the lander redirect chain
        # sometimes blocks scrapers, but the Afternic canonical page still tells us
        # whether the domain is actively listed for sale.
        if parking_url and "godaddy.com" in parking_url:
            canonical = f"https://www.afternic.com/forsale/{domain}"
            try:
                r_af = await client.get(canonical, headers=_BROWSER_HEADERS, timeout=8)
                af_title = (BeautifulSoup(r_af.text, "lxml").title.string or "").lower()
            except Exception:
                af_title = ""
            if "for sale" in af_title:
                logger.info("[%s] Probe timeout fallback: Afternic listing confirmed — marking for_sale", domain)
                return _result(domain, "for_sale", purchase_url=parking_url)
            if not af_title:
                # Afternic check failed — don't risk false taken
                logger.info("[%s] Probe timeout fallback: Afternic check failed — marking unknown", domain)
                return _result(domain, "unknown", purchase_url=parking_url)
            logger.info("[%s] Probe timeout fallback: not on Afternic — marking taken", domain)
            return _result(domain, "taken")
        logger.info("[%s] Retry also failed — marking unknown", domain)
        return _result(domain, "unknown", purchase_url=parking_url)

    # No parking NS — probe the domain directly.
    # If we get a real HTTP response with no signals, trust it (real website → taken).
    # If the first probe times out (some legitimate websites are slow), retry with 8s.
    # Only fall back to Sedo if both probes fail — Sedo is JS-only and can't confirm
    # listing status, but "unknown" is better than a false "taken" when we have no data.
    probe, http_ok = await _check_parking_page(client, domain)
    if probe["status"] in ("for_sale", "unknown"):
        return probe
    if http_ok:
        return _result(domain, "taken")
    logger.info("[%s] Non-parking probe failed, retrying (connect=2s, read=8s)", domain)
    probe, http_ok = await _check_parking_page(client, domain, timeout=httpx.Timeout(connect=2.0, read=8.0, write=5.0, pool=5.0))
    if probe["status"] in ("for_sale", "unknown"):
        return probe
    if http_ok:
        return _result(domain, "taken")
    sedo_result = await _check_sedo(client, domain)
    return sedo_result


async def check_domains(domains: list[str]) -> list[dict]:
    results = []
    async with httpx.AsyncClient(follow_redirects=True, verify=True) as client:
        for i, domain in enumerate(domains):
            if i > 0:
                await asyncio.sleep(1.0)
            results.append(await check_domain(client, domain))
    return results


async def check_domains_stream(candidates: list[str]):
    """Async generator: checks all TLDs for each base term concurrently, yields results
    group by group. Each base term's TLDs hit different registries so parallel is safe."""
    from collections import defaultdict
    groups: dict[str, list[str]] = defaultdict(list)
    for domain in candidates:
        base = domain.rsplit(".", 1)[0]
        groups[base].append(domain)

    async with httpx.AsyncClient(follow_redirects=True, verify=True) as client:
        for i, domains in enumerate(groups.values()):
            if i > 0:
                await asyncio.sleep(0.5)
            results = await asyncio.gather(*[check_domain(client, d) for d in domains])
            for r in results:
                yield r
