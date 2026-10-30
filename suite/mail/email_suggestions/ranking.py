from suite.mail.store.indexes.email_address import tokenize

# Ranks a hit that matched the "<name> <email>" text as a whole without any one field explaining it
# ("doe jane" against "Jane Doe jane@…") below every explained match.
_NO_MATCH = (2, 1, 1, 1, 1, 0)


def rank_email_addresses(query: str, addresses: list[dict], limit: int) -> list[dict]:
    """Return up to `limit` {name, email} of `addresses`, most relevant to `query` first.

    The addresses are expected to match already; this only orders them:

    1. A match on who someone is (name, or the address before the @) beats one on the domain, so
       "acme" doesn't fill up with everyone at acme.com.
    2. A complete word beats a partial one, so "doe" puts John Doe before Jane Doeringer.
    3. People the account has written to come first, most recently written to first; then
       colleagues and saved contacts; then everyone else.
    4. Finer match details, named addresses and shorter addresses settle what is left.
    """

    tokens = tokenize(query)
    ranked = sorted(addresses, key=lambda address: _relevance_key(tokens, address))
    return [{"name": address.get("name"), "email": address.get("email")} for address in ranked[:limit]]


def _relevance_key(query: list[str], address: dict) -> tuple:
    """Sort key for `address` against the query tokens; lower comes first."""

    name = address.get("name") or ""
    email = address.get("email") or ""
    local, _, domain = email.partition("@")

    fields = ((0, name), (0, local), (1, domain))
    field, partial, *details = min(
        ((rank, *match) for rank, text in fields if (match := _match_field(query, tokenize(text)))),
        default=_NO_MATCH,
    )

    last_sent_at = address.get("last_sent_at") or 0
    if last_sent_at:
        familiarity = 0
    elif address.get("is_colleague") or address.get("is_contact"):
        familiarity = 1
    else:
        familiarity = 2

    return (field, partial, familiarity, -last_sent_at, *details, 0 if name else 1, len(email), email.lower())


def _match_field(query: list[str], field: list[str]) -> tuple | None:
    """How well the query tokens match one field's tokens; lower is better, None if they don't.

    Returns ``(partial, whole, scattered, position, residual)``: whether the trailing term only
    starts a word, whether the query falls short of the whole field, whether its terms are scattered
    instead of one in-order run, whether the match misses the field's first word, and how many
    characters the trailing term left unmatched. For "doe", "Doe Jansen" scores (0, 1, 0, 0, 0)
    while "Jane Doeringer" scores (1, 1, 0, 1, 6).
    """

    if not all(term in field for term in query[:-1]):
        return None

    # Shortest word carrying the trailing prefix: "doe" over "doeringer" when both are present.
    tails = sorted(len(word) for word in field if word.startswith(query[-1]))
    if not tails:
        return None

    residual = tails[0] - len(query[-1])
    runs = [
        start
        for start in range(len(field) - len(query) + 1)
        if field[start : start + len(query) - 1] == query[:-1]
        and field[start + len(query) - 1].startswith(query[-1])
    ]
    starts_field = (0 in runs) if runs else field[0].startswith(query[0])

    return (
        1 if residual else 0,
        0 if field == query else 1,
        0 if runs else 1,
        0 if starts_field else 1,
        residual,
    )
