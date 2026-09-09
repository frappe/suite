"""§14.5 as data: legacy permission flags in, one role out.

Nothing here reads a row, a site, or a clock. The whole of the spec's two
mapping tables is a handful of pure functions, so a fixture can walk every
combination of the six flags and every principal spelling and compare the
answer against the table it came from. `validate_email_address` is the one
import, and it is a string check, not a query.

Two rules the tables state indirectly and this module makes explicit:

- **Denies round up, grants round down.** `deny = 1` is `NONE` whatever the
  flags say, and `share` without `write` contributes nothing at all: the
  highest *content* flag decides.
- **The ladder is strict** (§4.1), so a mapped level always carries every
  level below it. `upload` gains read because `UPLOAD` sits above `READ`,
  not because a rule adds it.
"""

from frappe.utils import validate_email_address

from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD

# The principals Build may write. `$LINK:<token>` is minted, never read from
# a legacy row, so it is not in this map.
GENERAL = "$GENERAL"
PUBLIC = "$PUBLIC"
GROUP_PREFIX = "$GROUP:"
LINK_PREFIX = "$LINK:"

# `Drive Permission.user` for "anyone with the link, including guests"
# (`suite/drive/utils/__init__.py:29-34`). An empty string, not NULL: the
# column is `not_nullable`.
ANONYMOUS = ""

# §6.5: `$PUBLIC` caps at READ, whatever the row mapped to.
PUBLIC_CEILING = READ

# §5.9 refusal 9 and [002]: a link may hold READ, COMMENT, UPLOAD, or EDIT.
# Never MANAGE.
LINK_CEILING = EDIT

# §3.3: `Drive Grant.principal` is `varchar(200)`.
PRINCIPAL_LENGTH = 200

CONTENT_FLAGS = ("read", "comment", "upload", "write")


def role_for_flags(flags: dict) -> int | None:
    """The role one collapsed `Drive Permission` row maps to, or None to drop.

    None means "no flags": the row grants nothing and §14.5 drops it. A row
    that denies is never dropped, even with no flags set, because a total
    deny is what `deny = 1` means on its own.
    """
    if flags.get("deny"):
        return NONE
    # `share` is deliberately absent from every branch below except the
    # first. §14.5: "share without write | share ignored; the highest
    # content flag wins".
    if flags.get("share") and flags.get("write"):
        return MANAGE
    if flags.get("write"):
        return EDIT
    if flags.get("upload"):
        return UPLOAD
    if flags.get("comment"):
        return COMMENT
    if flags.get("read"):
        return READ
    return None


def collapse(rows: list[dict]) -> dict:
    """Collapse duplicate `(entity, user)` rows the way the shipped patch does.

    `dedupe_drive_permissions.py` orders by `deny desc, creation`, keeps the
    first row, and then ORs in the set bits of every *same-polarity* row.
    A grant row therefore contributes nothing to a keeper that denies.

    Order matters and mapping order is not the same as flag order: a row
    with `read + share` maps to READ and a row with `write` maps to EDIT,
    but their union is `share + write`, which maps to MANAGE. Collapsing
    before mapping is the only way to reproduce the patch.
    """
    ordered = sorted(
        rows, key=lambda row: (0 if row.get("deny") else 1, row.get("creation") or "", row["name"])
    )
    keeper = dict(ordered[0])
    for other in ordered[1:]:
        if bool(other.get("deny")) != bool(keeper.get("deny")):
            continue
        for flag in ("read", "comment", "share", "upload", "write"):
            if other.get(flag):
                keeper[flag] = 1
    return keeper


def legacy_principal(user: str) -> str:
    """A legacy `Drive Permission.user` value with its padding removed.

    Live rows hold addresses with a trailing space, and `Drive Permission`
    is a plain Link column that never trimmed them. `validate_email_address`
    answers the trimmed address, so `principal_kind` called the padded value
    unknown and the row was dropped as a dead principal. §14.5 drops only
    rows "naming a User or User Group that no longer exists", and these name
    a live, enabled user, so the padding comes off before anything reads it.

    Only an address is trimmed. The empty string is `ANONYMOUS`, a
    whitespace-only value is not, and a `$` value is a sentinel: trimming
    either would change what the row means. The stored row is untouched, and
    so is `PermissionRow.user`, which the paging cursor compares against the
    column.
    """
    stripped = user.strip()
    if not stripped or stripped.startswith("$"):
        return user
    return stripped


def principal_kind(user: str) -> str:
    """Classify a legacy `Drive Permission.user` value.

    `anonymous` is the empty string, which §14.5 turns into one or two rows
    rather than one. Everything else maps to exactly one principal.
    """
    if user == ANONYMOUS:
        return "anonymous"
    if user == GENERAL:
        return "general"
    if user.startswith(GROUP_PREFIX):
        # A bare `$GROUP:` with no name is still a group here. The engine's
        # `_principal_kind` answers None for it, and `grants._principal_for`
        # drops it on the empty name, so both reach the same place.
        return "group"
    if user.startswith("$"):
        # A sentinel Drive never wrote. Treating it as an email would put a
        # `$`-prefixed string in `principal`, where the engine's own
        # `_principal_kind` would refuse to classify it and the row would
        # decide nothing for anyone. Dropping it says so in the report.
        return "unknown"
    # The engine takes a user principal only when it is a valid address
    # (`access._principal_kind`). `Drive Permission.user` is a plain Link to
    # `User`, so it can hold `Administrator` or `Guest`, and a grant written
    # with either would be a row nothing ever reads. Neither loses access:
    # `is_drive_admin` gives Administrator everything without a grant, and a
    # guest reads through `$PUBLIC`, never through a named principal.
    return "user" if validate_email_address(user) == user else "unknown"


def clamp_link(role: int) -> int:
    """Hold a minted link inside the ladder the engine will accept.

    §14.5 mints the link "at the mapped level", and a legacy `user = ""` row
    with `share` and `write` maps to MANAGE. §5.9 refusal 9 refuses a link
    above EDIT for everyone, Suite Admin included, and a MANAGE link would
    let whoever holds the token grant, revoke, and purge. Build writes rows
    with SQL, so no refusal fires by itself; clamping is what applies it.

    Dropping the row instead would take away access the site really had.
    Clamping keeps it and is counted, so the report says how many links
    landed one level below the row they came from.
    """
    return min(role, LINK_CEILING)


def clamp_public(role: int) -> int:
    """§6.5: `$PUBLIC` caps at READ. Anything above rides a link."""
    return min(role, PUBLIC_CEILING)


def merged_role(existing: int | None, incoming: int) -> int:
    """One row per `(node, principal)`: denies win, else the higher role.

    Two sources can name one pair — a `Drive Permission` row and a Sheet
    `DocShare` row on the same sheet — and the unique index holds only one.
    A stored deny is role 0, so a plain `max` would silently promote it.
    """
    if existing is None:
        return incoming
    if existing == NONE or incoming == NONE:
        return NONE
    return max(existing, incoming)


def docshare_role(row: dict) -> int | None:
    """§14.5: Sheet `DocShare` `read` to READ, `write` to EDIT.

    `share` is not in the table. The app never writes it
    (`suite/sheets/api.py:194` passes `share=0`), and §14.5 ignores `share`
    on a Drive Permission row too, so a stray one grants nothing here.
    """
    if row.get("write"):
        return EDIT
    if row.get("read"):
        return READ
    return None
