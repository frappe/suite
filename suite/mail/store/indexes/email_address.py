import re

from frappe.utils import EMAIL_MATCH_PATTERN

from suite.store.search_store import FieldSpec, SearchStore

# Runs of alphanumerics, Unicode-aware, mirroring the tokenizer the indexed text went through —
# an ASCII-only pattern would shred "Müller" into "m" + "ller" and never match the indexed "müller".
_TOKEN_PATTERN = re.compile(r"[^\W_]+")

# Quote characters some clients wrap display names in, e.g. "'Jane Doe'".
_WRAPPING_QUOTES = "'\"`"

# Candidates pulled from the index before ranking. Tantivy returns prefix matches unscored, i.e. in
# index order, so the best address can sit anywhere in the match set and the pool has to be deep
# enough to hold it: this covers an entire address book of that size, and costs ~20ms in the worst
# case measured — a single-letter query against a 20k-address book, where the next keystroke narrows
# the field anyway. Anything more selective ranks in well under a millisecond.
_CANDIDATE_POOL = 5000

# Ranks below every explained match. A hit matched the indexed "<name> <email>" blob, which can span
# fields — "doe jane" matches "Jane Doe jane@…" — so a candidate need not match any single field.
_NO_MATCH = (9, 9, 9, 9, 9)


def _tokenize(text: str | None) -> list[str]:
    """Split text into lowercased alphanumeric tokens, the way the index tokenized it."""

    return _TOKEN_PATTERN.findall((text or "").lower())


def _match_field(query: list[str], field: list[str]) -> tuple | None:
    """Rank how well `query` tokens match one field's tokens; lower is better, None if they don't.

    Returns ``(whole, scattered, position, residual)``: whether the query covers the field whole,
    whether its terms are scattered instead of forming one in-order run, whether the match starts at
    the field's first word, and how many characters the trailing term left unmatched. So for
    "doe", the name "Doe Jansen" scores (1, 0, 0, 0) — a word-exact match on the first word — while
    "Jane Doeringer" only manages (1, 0, 1, 6).
    """

    if not all(term in field for term in query[:-1]):
        return None

    # Shortest word carrying the trailing prefix: "doe" over "doeringer" when both are present.
    tails = sorted(len(word) for word in field if word.startswith(query[-1]))
    if not tails:
        return None

    residual = tails[0] - len(query[-1])
    # An in-order, adjacent run beats the same terms scattered across the field.
    runs = [
        start
        for start in range(len(field) - len(query) + 1)
        if field[start : start + len(query) - 1] == query[:-1]
        and field[start + len(query) - 1].startswith(query[-1])
    ]
    scattered = 0 if runs else 1
    starts_field = (0 in runs) if runs else field[0].startswith(query[0])

    return (0 if field == query else 1, scattered, 0 if starts_field else 1, residual)


def _relevance_key(query: list[str], hit: dict) -> tuple:
    """Sort key ordering a search hit by how relevant it is to the query; lower comes first."""

    name = hit.get("name") or ""
    email = hit.get("email") or ""
    local, _, domain = email.partition("@")

    # A match on who someone is — their name, or the part of the address before the @ — outranks one
    # on where they are, so a query for "exa" doesn't fill up with everyone at example.com.
    matches = ((0, name), (0, local), (1, domain))
    best = min(
        ((rank, *match) for rank, field in matches if (match := _match_field(query, _tokenize(field)))),
        default=_NO_MATCH,
    )

    # Named, shorter addresses first among equals; the address itself keeps the order deterministic.
    return (*best, 0 if name else 1, len(email), email.lower())


def _sanitize_name(name: str | None) -> str | None:
    """Strip whitespace and any matching quote pairs wrapping a display name."""

    name = (name or "").strip()
    while len(name) >= 2 and name[0] == name[-1] and name[0] in _WRAPPING_QUOTES:
        name = name[1:-1].strip()

    return name or None


class EmailAddressIndex(SearchStore):
    """Shared, per-account index of email addresses for recipient suggestions.

    Sources (cached messages, contact cards, ...) feed in plain {name, email} dicts, so the index
    knows nothing about where an address came from. Each document is keyed by the lowercased
    address, so re-indexing the same address from any source is an upsert and addresses stay unique
    by construction. The index is cumulative: entries are only added or updated, never removed when
    a source is evicted, so it doubles as an address book of everyone the user has corresponded with.
    """

    ENTITY = "email_address"
    FIELDS = (
        # Lowercased address; the unique document key, so the same address upserts across sources.
        FieldSpec("id", stored=True, tokenizer="raw"),
        # Original-cased address and display name, returned verbatim in suggestions.
        FieldSpec("email", stored=True, tokenizer="raw"),
        FieldSpec("name", stored=True, tokenizer="raw"),
        # "name email" blob, tokenized so a query can match either part.
        FieldSpec("text"),
    )
    DEFAULT_SEARCH_FIELDS = ("text",)

    def to_document(self, address: dict) -> dict:
        email = (address.get("email") or "").strip()
        name = _sanitize_name(address.get("name"))

        return {
            "id": email.lower(),
            "email": email,
            "name": name,
            "text": " ".join(filter(None, (name, email))),
        }

    def index_addresses(self, addresses: list[dict]) -> int:
        """Upsert the given {name, email} dicts; dedupes the batch and silently skips entries whose
        email is missing or syntactically invalid."""

        unique = {}
        for address in addresses:
            email = (address.get("email") or "").strip()
            if EMAIL_MATCH_PATTERN.fullmatch(email):
                unique[email.lower()] = address

        return self.index_documents(list(unique.values()))

    def search_email_addresses(self, query: str, limit: int = 10) -> list[dict]:
        """Return up to `limit` {name, email} addresses matching `query`, most relevant first.

        Every token of the query must appear in the address's name or email, with the last token
        matched as a prefix — so "jan" matches "jane", and "jane.d" matches "jane.d@…" / "Jane Doe"
        but not "jane@…" or "jane.r@…". The index scores those matches all alike, so a pool of
        candidates is ranked here instead: an address wins by matching more of a name or local part,
        earlier, and in order. Searching "doe" therefore leads with "John Doe <john@example.com>"
        rather than "Jane Doeringer <jane@example.com>". Documents are unique per address, so the
        hits need no further deduping.
        """

        tokens = _tokenize(query)
        if not tokens:
            return []

        hits, _total_count = self.search_prefix(tokens, limit=max(limit, _CANDIDATE_POOL))
        hits.sort(key=lambda hit: _relevance_key(tokens, hit))
        return [{"name": hit.get("name"), "email": hit.get("email")} for hit in hits[:limit]]
