"""§14.4 title dedupe over one sibling group, checked without a database.

`SiblingTitles` holds the Active titles below one parent and hands back the
first free name. The rule is §8.6's: the oldest keeps the plain title, later
ones get ` (2)`, ` (3)`. The tests below fix the extension split, the
next-free search, and the order rows are fed in.
"""

import types
import unittest

from suite.drive.patches.build.titles import TITLE_LENGTH, SiblingTitles, order_key


def row(name: str, creation=None) -> types.SimpleNamespace:
    """One sibling row, with the two fields `order_key` reads."""
    return types.SimpleNamespace(name=name, creation=creation)


class TestClaim(unittest.TestCase):
    def test_the_first_claim_keeps_the_plain_title(self):
        """The oldest sibling keeps the title the site already showed."""
        self.assertEqual(SiblingTitles().claim("report"), "report")

    def test_the_second_and_third_claims_count_upward(self):
        """Later siblings get ` (2)` and ` (3)`, in the order they are fed in."""
        titles = SiblingTitles()
        self.assertEqual(titles.claim("report"), "report")
        self.assertEqual(titles.claim("report"), "report (2)")
        self.assertEqual(titles.claim("report"), "report (3)")

    def test_the_suffix_goes_before_the_extension(self):
        """A file manager reads the extension off the end, so it must stay last."""
        titles = SiblingTitles({"report.pdf"})
        self.assertEqual(titles.claim("report.pdf"), "report (2).pdf")

    def test_a_double_extension_splits_only_at_the_last_dot(self):
        """`splitext` takes one extension, so `report.tar.gz` keeps `.tar`."""
        titles = SiblingTitles({"report.tar.gz"})
        self.assertEqual(titles.claim("report.tar.gz"), "report.tar (2).gz")

    def test_a_title_with_no_extension_gets_a_plain_suffix(self):
        """Folders and documents carry no extension of their own (§8.6)."""
        titles = SiblingTitles({"Invoices"})
        self.assertEqual(titles.claim("Invoices"), "Invoices (2)")

    def test_a_dotfile_keeps_its_leading_dot(self):
        """`.env` is a stem, not an extension, so the suffix goes on the end."""
        # Renaming it to ` (2).env` would drop the leading dot and change
        # what the file is.
        titles = SiblingTitles({".env"})
        self.assertEqual(titles.claim(".env"), ".env (2)")

    def test_a_taken_suffix_is_skipped(self):
        """The search finds the next free slot, not the count of siblings."""
        # `get_new_file_name` returns `<stem> (<count>)<ext>`, so with
        # `a.txt` and `a (2).txt` already present it hands back `a (2).txt`
        # again, a name that is taken. The next free rule gives `a (3).txt`.
        titles = SiblingTitles({"a.txt", "a (2).txt"})
        self.assertEqual(titles.claim("a.txt"), "a (3).txt")

    def test_a_gap_in_the_taken_suffixes_is_filled(self):
        """The first free number wins, even when a higher one is taken."""
        titles = SiblingTitles({"a.txt", "a (3).txt"})
        self.assertEqual(titles.claim("a.txt"), "a (2).txt")

    def test_the_claimed_name_is_added_to_taken(self):
        """Every claim reserves its answer, so no two siblings can share a title."""
        titles = SiblingTitles()
        for expected in ("a.txt", "a (2).txt", "a (3).txt"):
            with self.subTest(expected=expected):
                claimed = titles.claim("a.txt")
                self.assertEqual(claimed, expected)
                self.assertIn(claimed, titles.taken)

    def test_a_plain_claim_is_reserved_too(self):
        """The first claim reserves the plain title, not only the suffixed ones."""
        titles = SiblingTitles()
        self.assertEqual(titles.claim("report"), "report")
        self.assertIn("report", titles.taken)

    def test_seeded_titles_are_copied_not_shared(self):
        """Build reuses the seed set per parent, so claiming must not write to it."""
        seed = {"a.txt"}
        SiblingTitles(seed).claim("a.txt")
        self.assertEqual(seed, {"a.txt"})

    def test_an_empty_seed_and_no_seed_behave_alike(self):
        """`None` means "no siblings yet", the same as an empty set."""
        self.assertEqual(SiblingTitles(None).claim("a"), "a")
        self.assertEqual(SiblingTitles(set()).claim("a"), "a")


class TestOrderKey(unittest.TestCase):
    def test_rows_sort_oldest_first(self):
        """The oldest sibling keeps the plain title, so it must be deduped first."""
        rows = [
            row("c", "2021-03-01 00:00:00"),
            row("a", "2020-01-01 00:00:00"),
            row("b", "2020-06-01 00:00:00"),
        ]
        self.assertEqual([r.name for r in sorted(rows, key=order_key)], ["a", "b", "c"])

    def test_a_missing_creation_sorts_before_a_present_one(self):
        """A hand-inserted row with no `creation` gets the plain title."""
        undated = row("z")
        dated = row("a", "2020-01-01 00:00:00")
        self.assertEqual([r.name for r in sorted([dated, undated], key=order_key)], ["z", "a"])

    def test_equal_creations_break_on_the_name(self):
        """Two rows in one microsecond must resolve the same way on a rerun."""
        first = row("a", "2020-01-01 00:00:00")
        second = row("b", "2020-01-01 00:00:00")
        self.assertEqual([r.name for r in sorted([second, first], key=order_key)], ["a", "b"])

    def test_missing_creations_break_on_the_name(self):
        """Two undated rows still order by id, so the run is repeatable."""
        rows = [row("b"), row("a")]
        self.assertEqual([r.name for r in sorted(rows, key=order_key)], ["a", "b"])

    def test_the_key_is_a_pair_of_strings(self):
        """A datetime and a string must not be compared, so `creation` is cast."""
        self.assertEqual(order_key(row("a", "2020-01-01 00:00:00")), ("2020-01-01 00:00:00", "a"))
        self.assertEqual(order_key(row("a")), ("", "a"))
        for value in ("2020-01-01 00:00:00", None):
            with self.subTest(creation=value):
                key = order_key(row("a", value))
                self.assertEqual(len(key), 2)
                self.assertTrue(all(isinstance(part, str) for part in key))

    def test_a_non_string_creation_is_cast(self):
        """`frappe.get_all` can hand back a datetime, and sorting must survive it."""

        class Stamp:
            def __str__(self):
                return "2020-01-01 00:00:00"

        self.assertEqual(order_key(row("a", Stamp())), ("2020-01-01 00:00:00", "a"))


if __name__ == "__main__":
    unittest.main()


class TestColumnWidth(unittest.TestCase):
    """`Drive Node.title` is `varchar(140)`, and a suffix adds to a full name."""

    def test_a_full_title_still_fits_after_a_suffix(self):
        """A 140-character name plus " (2)" is 144, which the insert refuses."""
        taken = SiblingTitles()
        full = "n" * 136 + ".txt"
        self.assertEqual(taken.claim(full), full)
        second = taken.claim(full)
        self.assertLessEqual(len(second), TITLE_LENGTH)
        self.assertTrue(second.endswith(" (2).txt"))

    def test_the_extension_survives_the_shortening(self):
        """A file manager reads the extension off the end, so the stem gives way."""
        taken = SiblingTitles()
        full = "n" * 130 + ".tar.gz"
        taken.claim(full)
        self.assertTrue(taken.claim(full).endswith(" (2).gz"))

    def test_shortened_titles_stay_unique(self):
        """Shortening must not make two siblings collide again."""
        taken = SiblingTitles()
        full = "n" * 136 + ".txt"
        chosen = [taken.claim(full) for _ in range(12)]
        self.assertEqual(len(set(chosen)), 12)
        for title in chosen:
            self.assertLessEqual(len(title), TITLE_LENGTH)

    def test_an_over_long_source_title_is_cut_to_the_column(self):
        """`File.file_name` is the same width, so this is a guard, not a path."""
        taken = SiblingTitles()
        self.assertEqual(len(taken.claim("x" * 400)), TITLE_LENGTH)

    def test_the_width_matches_the_framework_default(self):
        """`Drive Node.title` has no `length`, so it takes frappe's default."""
        from frappe.database.database import Database

        self.assertEqual(TITLE_LENGTH, Database.VARCHAR_LEN)
