"""§14.4 title dedupe, as a pure function over one sibling group.

`Drive Node.title` is unique among Active siblings (§3.1), and the legacy
`File` table has no such rule, so a folder can hold three rows called
`report.pdf`. §8.6 names the rule Build uses: "Every path that creates a
node without a user in the loop deduplicates instead of refusing", and
"the oldest keeps the plain title, later ones get ` (2)`, ` (3)`".

Two things this does **not** copy from `get_new_file_name`
(`suite/drive/utils/__init__.py:644`):

- Its suffix is the *count* of LIKE-matching siblings, not the next free
  number, so it can hand back a name that is already taken. The engine's
  own writer (`nodes._deduplicated_title`) counts upward until the name is
  free, and that is the rule reproduced here.
- It reads the database per candidate. Build already holds the whole
  sibling group, so the answer comes out of a set.

Trashed siblings are left alone (§14.4): they hold no title reservation,
and restore re-dedupes when the user asks for the node back.
"""

import os

# `Drive Node.title` is `Data` with no explicit length, so the column is
# `frappe.database.database.VARCHAR_LEN`. `File.file_name` is the same width,
# which means a copied title always fits and a deduplicated one may not: the
# suffix adds at least four characters to a title that was already full.
TITLE_LENGTH = 140


class SiblingTitles:
    """The Active titles taken so far below one parent.

    Fed in a fixed order — oldest first — so the same source rows always
    produce the same renames, run after run and site after site.
    """

    def __init__(self, taken: set[str] | None = None):
        self.taken = set(taken or ())

    def claim(self, title: str) -> str:
        """Take `title`, or the first free ` (n)` variant of it, and keep it."""
        title = title[:TITLE_LENGTH]
        chosen = title if title not in self.taken else self._next_free(title)
        self.taken.add(chosen)
        return chosen

    def _next_free(self, title: str) -> str:
        # `splitext` on the whole title, so `report.tar.gz` becomes
        # `report.tar (2).gz`. That is what the legacy rule did and what the
        # engine still does, and a file manager reading the extension off
        # the end keeps working.
        stem, extension = os.path.splitext(title)
        suffix = 2
        while True:
            candidate = _fit(stem, suffix, extension)
            if candidate not in self.taken:
                return candidate
            suffix += 1


def _fit(stem: str, suffix: int, extension: str) -> str:
    """`<stem> (n)<ext>`, shortened from the middle so it fits the column.

    Two Active siblings can both be called a 140-character name. The second
    one needs a suffix, and a 144-character title is not a title the column
    holds: the insert fails and takes the whole 1000-row batch with it.
    The stem gives way rather than the suffix, because the suffix is what
    makes the title unique and the extension is what a file manager reads.
    """
    tail = f" ({suffix}){extension}"
    if len(stem) + len(tail) <= TITLE_LENGTH:
        return f"{stem}{tail}"
    room = TITLE_LENGTH - len(tail)
    if room > 0:
        return f"{stem[:room]}{tail}"
    # The extension alone fills the column. Nothing of the name survives,
    # so keep the part that still distinguishes one sibling from another.
    return tail.strip()[:TITLE_LENGTH]


def order_key(row) -> tuple:
    """The order siblings are deduped in: oldest first, id as the tiebreak.

    Two rows created in the same microsecond, or with `creation` missing on
    a hand-inserted row, must still resolve the same way on a rerun, so the
    id decides rather than whatever order the database returned.
    """
    return (str(row.creation or ""), row.name)
