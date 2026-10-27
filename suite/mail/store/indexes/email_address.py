import re

from frappe.utils import EMAIL_MATCH_PATTERN

from suite.store.search_store import FieldSpec, SearchStore

# Runs of alphanumerics, Unicode-aware, mirroring the tokenizer the indexed text went through —
# an ASCII-only pattern would shred "Müller" into "m" + "ller" and never match the indexed "müller".
_TOKEN_PATTERN = re.compile(r"[^\W_]+")

# Quote characters some clients wrap display names in, e.g. "'Jane Doe'".
_WRAPPING_QUOTES = "'\"`"


def tokenize(text: str | None) -> list[str]:
    """Split text into lowercased alphanumeric tokens, the way the index tokenized it."""

    return _TOKEN_PATTERN.findall((text or "").lower())


def matches_email_address(query: str, address: dict) -> bool:
    """Whether the index would return `address` for `query`: every query token appears in its
    "<name> <email>" text, the last one as a prefix. Lets addresses from outside the index (the
    directory, a JMAP lookup) be filtered the way the index filters its own."""

    tokens = tokenize(query)
    if not tokens:
        return False

    words = tokenize(" ".join(filter(None, (address.get("name"), address.get("email")))))
    return all(token in words for token in tokens[:-1]) and any(word.startswith(tokens[-1]) for word in words)


def _sanitize_name(name: str | None) -> str | None:
    """Strip whitespace and any matching quote pairs wrapping a display name."""

    name = (name or "").strip()
    while len(name) >= 2 and name[0] == name[-1] and name[0] in _WRAPPING_QUOTES:
        name = name[1:-1].strip()

    return name or None


class EmailAddressIndex(SearchStore):
    """Shared, per-account index of email addresses for recipient suggestions.

    Sources (cached messages, contact cards, JMAP lookups) feed in address dicts —
    ``{name, email, last_sent_at?, is_contact?}`` — keyed by the lowercased address, so the same
    address upserts across sources. Every field merges in a way that is safe to repeat: a name is
    kept unless a newer one arrives, `last_sent_at` only moves forward, and `is_contact` only turns
    on. Re-indexing what is already indexed therefore changes nothing. The index is cumulative —
    nothing is removed when a source is evicted — so it doubles as an address book of everyone the
    account has corresponded with.
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
        # When the account last sent mail to the address, as a Unix timestamp; 0 if it never has.
        FieldSpec("last_sent_at", kind="integer", stored=True),
        FieldSpec("is_contact", kind="boolean", stored=True),
    )
    DEFAULT_SEARCH_FIELDS = ("text",)
    MERGE_ON_UPSERT = True

    def to_document(self, address: dict) -> dict:
        email = (address.get("email") or "").strip()
        name = _sanitize_name(address.get("name"))

        return {
            "id": email.lower(),
            "email": email,
            "name": name,
            "text": " ".join(filter(None, (name, email))),
            "last_sent_at": int(address.get("last_sent_at") or 0),
            "is_contact": bool(address.get("is_contact")),
        }

    def merge_document(self, document: dict, existing: dict | None) -> dict:
        """Fold what is already indexed for the address into `document`.

        A batch carrying the same address twice merges here too, so the rules hold within a batch:
        a nameless sighting never erases a name, and dates and the contact flag never go back.
        """

        if existing is None:
            return document

        document["name"] = document["name"] or existing.get("name")
        document["text"] = " ".join(filter(None, (document["name"], document["email"])))
        document["last_sent_at"] = max(document["last_sent_at"], existing.get("last_sent_at") or 0)
        document["is_contact"] = document["is_contact"] or bool(existing.get("is_contact"))
        return document

    def index_addresses(self, addresses: list[dict]) -> int:
        """Upsert the given address dicts, skipping any whose email is missing or invalid."""

        valid = [
            address
            for address in addresses
            if EMAIL_MATCH_PATTERN.fullmatch((address.get("email") or "").strip())
        ]
        return self.index_documents(valid)

    def get_email_address_hits(self, query: str) -> list[dict]:
        """Return every indexed address matching `query`, unranked.

        Every token of the query must appear in the address's name or email, the last one as a
        prefix — so "jan" matches "jane", and "jane.d" matches "jane.d@…" and "Jane Doe" but not
        "jane@…". Every match comes back, not a page of them: the index scores them all alike, so a
        page would be an arbitrary slice and the caller ranks the whole set. A single letter against
        a 20k-address book is the worst case at ~90ms; anything more selective takes about 1ms.
        """

        tokens = tokenize(query)
        if not tokens:
            return []

        hits, _total = self.search_prefix(tokens, limit=None)
        return hits
