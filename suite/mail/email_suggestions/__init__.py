import frappe
from frappe import _
from frappe.utils import EMAIL_MATCH_PATTERN
from frappe.utils.caching import redis_cache

from suite.mail.doctype.contact_card.contact_card import fetch_contact_cards
from suite.mail.email_suggestions.ranking import rank_email_addresses
from suite.mail.jmap import JMAP_REFUSALS, format_method_error, get_account_client
from suite.mail.store import get_email_address_index
from suite.mail.store.indexes.email_address import matches_email_address
from suite.mail.utils import log_mail_error

# How long a query that matched nothing anywhere is answered from memory instead of asking JMAP again.
MISS_TTL = 60

ADDRESS_FIELDS = ("from", "to", "cc", "bcc")


class EmailSuggestions:
    """Recipient suggestions for one JMAP account, taken from the cheapest source that has any."""

    def __init__(self, account: str) -> None:
        self.account = account

    def get_suggestions(self, text: str | None, limit: int = 10) -> list[dict]:
        """Return up to `limit` {name, email} addresses matching `text`, most relevant first.

        The local sources — the site directory and the account's address index — answer first. JMAP
        contacts are asked only when they find nothing, and JMAP mail only when contacts find nothing
        too. A query that finds nothing anywhere is remembered for `MISS_TTL`, so asking it again
        costs no JMAP round trips. See `rank_email_addresses` for the order.
        """

        query = (text or "").strip()
        if not query or self.is_recent_miss(query):
            return []

        if suggestions := self.get_local_suggestions(query, limit):
            return suggestions

        try:
            suggestions = self.get_contact_suggestions(query, limit)
            suggestions = suggestions or self.get_mail_suggestions(query, limit)
        except JMAP_REFUSALS as e:
            # Asked on every keystroke, so a refusal shows no suggestions instead of an error. It is
            # not remembered as a miss: the server may answer the next time.
            log_mail_error(_("Failed to look up email suggestions"), format_method_error(e))
            return []

        if not suggestions:
            frappe.cache.set_value(self.get_miss_key(query), True, expires_in_sec=MISS_TTL)

        return suggestions

    def get_local_suggestions(self, query: str, limit: int) -> list[dict]:
        """Directory users and accounts merged with the address index, ranked as one list."""

        hits = get_email_address_index(self.account).get_email_address_hits(query)
        directory = [
            address for address in get_directory_addresses() if matches_email_address(query, address)
        ]
        return rank_email_addresses(query, _deduplicate(hits + directory), limit)

    def get_contact_suggestions(self, query: str, limit: int) -> list[dict]:
        """Addresses on JMAP contact cards matching `query`; fetching caches and indexes the cards."""

        filter = {"operator": "OR", "conditions": [{"text": query}, {"email": query}]}
        cards, _total = fetch_contact_cards(self.account, filter, 0, limit)
        addresses = [
            {"name": card.get("full_name"), "email": email.get("address"), "is_contact": True}
            for card in cards
            for email in card.get("emails") or []
        ]
        return rank_email_addresses(query, _deduplicate(addresses), limit)

    def get_mail_suggestions(self, query: str, limit: int) -> list[dict]:
        """Addresses on the account's most recent JMAP mail matching `query`, indexed for next time.

        The server matches the field, which may be on a different address of the same message, so
        each address is filtered again the way the index matches.
        """

        client = get_account_client(self.account)
        with client.batch() as b:
            q = b.mail.email.query(
                filter={"operator": "OR", "conditions": [{field: query} for field in ADDRESS_FIELDS]},
                sort=[{"property": "receivedAt", "isAscending": False}],
                position=0,
                limit=limit,
                calculate_total=False,
            )
            g = b.mail.email.get(ids=q.ref_ids(), properties=list(ADDRESS_FIELDS))

        addresses = [
            address
            for email in (item.to_wire() for item in g.result.items)
            for field in ADDRESS_FIELDS
            for address in email.get(field) or []
            if matches_email_address(query, address)
        ]
        addresses = _deduplicate(addresses)
        self.index_addresses(addresses)
        return rank_email_addresses(query, addresses, limit)

    def index_addresses(self, addresses: list[dict]) -> None:
        """Add addresses found on uncached mail to the index; never fail a suggestion over it.

        Undated even when the account sent the mail: it is dated once the message is cached.
        """

        try:
            get_email_address_index(self.account).index_addresses(addresses)
        except Exception:
            log_mail_error(
                _("Failed to index suggested addresses for search"), frappe.get_traceback(with_context=True)
            )

    def is_recent_miss(self, query: str) -> bool:
        return bool(frappe.cache.get_value(self.get_miss_key(query)))

    def get_miss_key(self, query: str) -> str:
        return f"mail:email_suggestions:miss:{self.account}:{query.lower()}"


# Saves clear the cache; the TTL only backs up writes that skip doc events.
@redis_cache(ttl=5 * 60)
def get_directory_addresses() -> list[dict]:
    """Every enabled Suite user and every JMAP account named by an address, as colleagues."""

    user = frappe.qb.DocType("User")
    has_role = frappe.qb.DocType("Has Role")
    users = (
        frappe.qb.from_(user)
        .join(has_role)
        .on(has_role.parent == user.name)
        .select(user.full_name.as_("name"), user.name.as_("email"))
        .where((user.enabled == 1) & (has_role.parenttype == "User") & (has_role.role == "Suite User"))
        .distinct()
        .run(as_dict=True)
    )
    accounts = [{"name": None, "email": name} for name in frappe.get_all("JMAP Account", pluck="_name")]

    return _deduplicate([{**address, "is_colleague": True} for address in users + accounts])


def clear_directory_addresses(*args) -> None:
    """Doc event: drop the cached directory once the User or JMAP Account change commits.

    Not before: a request between the save and the commit would cache the old rows again.
    """

    frappe.db.after_commit.add(get_directory_addresses.clear_cache)


def _deduplicate(addresses: list[dict]) -> list[dict]:
    """Collapse addresses by lowercased email, dropping invalid ones and merging what each copy knows.

    The first copy's spelling of the address wins; the name is the first one any copy has, the date
    the latest, and the contact and colleague flags are on if any copy has them on.
    """

    unique = {}
    for address in addresses:
        email = (address.get("email") or "").strip()
        if not EMAIL_MATCH_PATTERN.fullmatch(email):
            continue

        kept = unique.setdefault(
            email.lower(),
            {"name": None, "email": email, "last_sent_at": 0, "is_contact": False, "is_colleague": False},
        )
        kept["name"] = kept["name"] or address.get("name") or None
        kept["last_sent_at"] = max(kept["last_sent_at"], address.get("last_sent_at") or 0)
        kept["is_contact"] = kept["is_contact"] or bool(address.get("is_contact"))
        kept["is_colleague"] = kept["is_colleague"] or bool(address.get("is_colleague"))

    return list(unique.values())
