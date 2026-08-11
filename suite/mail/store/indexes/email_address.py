import re

from frappe.utils import EMAIL_MATCH_PATTERN

from suite.store.search_store import FieldSpec, SearchStore

# Runs of alphanumerics, Unicode-aware, mirroring the tokenizer the indexed text went through —
# an ASCII-only pattern would shred "Müller" into "m" + "ller" and never match the indexed "müller".
_TOKEN_PATTERN = re.compile(r"[^\W_]+")

# Quote characters some clients wrap display names in, e.g. "'Jane Doe'".
_WRAPPING_QUOTES = "'\"`"

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

    # Among matches the query can't tell apart, the address corresponded with most wins: typing
    # "user" leads with whichever of user@example.com / user@example.org has been seen more. It
    # ranks below the match itself on purpose — a much-mailed "Jane Doeringer" shouldn't displace
    # "John Doe" for the query "doe".
    correspondence = -(hit.get("count") or 0)

    # Named, shorter addresses first among equals; the address itself keeps the order deterministic.
    return (*best, correspondence, 0 if name else 1, len(email), email.lower())


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

    Each entry also carries how often it has been seen, which orders suggestions the query itself
    can't tell apart. Only sources that represent correspondence pass `count=True`, so the tally
    tracks who the user writes to and hears from rather than how often a source happens to re-index.
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
        # Sightings after the first, so a newly indexed address starts at 0. Ranked in Python, so
        # it only has to be stored — nothing sorts or filters on it inside the index.
        FieldSpec("count", kind="integer", stored=True),
    )
    DEFAULT_SEARCH_FIELDS = ("text",)
    # Sightings accumulate, so an upsert has to see the count it is replacing.
    MERGE_ON_UPSERT = True

    def to_document(self, address: dict) -> dict:
        email = (address.get("email") or "").strip()
        name = _sanitize_name(address.get("name"))

        return {
            "id": email.lower(),
            "email": email,
            "name": name,
            "text": " ".join(filter(None, (name, email))),
            # Sightings in this batch; `merge_document` resolves them against what is indexed.
            "count": address.get("sightings") or 0,
        }

    def merge_document(self, document: dict, existing: dict | None) -> dict:
        """Fold this batch's sightings into the count already indexed for the address.

        The sighting that first indexes an address doesn't count — it establishes the entry — so a
        new address starts at 0 and every later sighting adds one. An upsert carrying no sightings
        (`index_addresses(count=False)`) refreshes the entry and leaves its count where it stood.
        """

        if existing is None:
            document["count"] = max(document["count"] - 1, 0)
        else:
            document["count"] += existing.get("count") or 0
            # Sources differ in what they know: keep a name learned elsewhere rather than let a
            # nameless sighting of the same address erase it.
            document["name"] = document["name"] or existing.get("name")
            document["text"] = " ".join(filter(None, (document["name"], document["email"])))

        return document

    def index_addresses(self, addresses: list[dict], count: bool = True) -> int:
        """Upsert the given {name, email} dicts; dedupes the batch and silently skips entries whose
        email is missing or syntactically invalid.

        Every occurrence of an address in `addresses` counts as a sighting, not every call: one
        batch can carry a whole page of messages, and a rebuild feeds in hundreds at a time, so
        collapsing them would tally how the caller batched its work instead of how much mail the
        address is on. Pass `count=False` for a source that says nothing about correspondence — a
        contact sync re-indexes the whole address book, and counting it would lift contacts the user
        never writes to above the addresses they do.
        """

        unique = {}
        sightings = {}
        for address in addresses:
            email = (address.get("email") or "").strip()
            if not EMAIL_MATCH_PATTERN.fullmatch(email):
                continue

            key = email.lower()
            current = unique.get(key)
            # Last one wins, so the freshest name and casing survive — but not a *nameless* later
            # sighting: one batch can carry the same address named from one message and bare from
            # the next, and dropping the name there would index it as an address with no one behind
            # it. `merge_document` keeps a name across batches; this keeps one within a batch.
            # Sanitized on both sides, so a name that is only quote characters counts as no name —
            # which is what it will be by the time `to_document` is through with it.
            named = _sanitize_name(address.get("name"))
            if current is None or named or not _sanitize_name(current.get("name")):
                unique[key] = address

            sightings[key] = sightings.get(key, 0) + 1

        sources = [
            {**address, "sightings": sightings[key] if count else 0} for key, address in unique.items()
        ]
        return self.index_documents(sources)

    def search_email_addresses(self, query: str, limit: int = 10) -> list[dict]:
        """Return up to `limit` {name, email} addresses matching `query`, most relevant first.

        Every token of the query must appear in the address's name or email, with the last token
        matched as a prefix — so "jan" matches "jane", and "jane.d" matches "jane.d@…" / "Jane Doe"
        but not "jane@…" or "jane.r@…". The index scores those matches all alike, so they are ranked
        here instead: an address wins by matching more of a name or local part, earlier, and in
        order. Searching "doe" therefore leads with "John Doe <john@example.com>" rather than
        "Jane Doeringer <jane@example.com>". Matches the query can't separate are ordered by how
        often the address has been corresponded with, so "user" leads with whichever of
        user@example.com / user@example.org carries more mail. Documents are unique per address, so
        the hits need no further deduping.

        Every match is ranked, not a slice of them — hence the unbounded fetch. Unscored hits come
        back in index order, so the best address can sit anywhere in the match set, and cutting the
        set before ranking would drop it: whoever was indexed first would win a broad query
        outright. Cost therefore scales with how many addresses match — a single letter against a
        20k-address book is the worst case at ~90ms, and anything more selective comes back in a
        millisecond or so.
        """

        tokens = _tokenize(query)
        if not tokens:
            return []

        hits, _total = self.search_prefix(tokens, limit=None)
        hits.sort(key=lambda hit: _relevance_key(tokens, hit))
        return [{"name": hit.get("name"), "email": hit.get("email")} for hit in hits[:limit]]
