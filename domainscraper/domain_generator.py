def generate_candidates(terms: list[str], tlds: list[str]) -> list[str]:
    """Generate exact domain candidates from the provided terms and TLDs."""
    words = [t.lower().strip() for t in terms if t.strip()]
    tlds = [t if t.startswith(".") else f".{t}" for t in tlds]

    if not words or not tlds:
        return []

    seen: set[str] = set()
    unique_bases: list[str] = []
    for term in words:
        if term not in seen:
            seen.add(term)
            unique_bases.append(term)

    return [f"{base}{tld}" for base in unique_bases for tld in tlds]
