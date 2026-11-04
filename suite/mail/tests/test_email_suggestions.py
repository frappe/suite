# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Recipient suggestions: local sources answer first and rank as one list, JMAP contacts are asked
only when they find nothing, JMAP mail only when contacts find nothing too, and a query that finds
nothing anywhere is not sent to JMAP again for a while. Within a list, a better match comes first,
then the people the account writes to, then colleagues and contacts, then everyone else."""

from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import CallbackManager
from jmap import MethodError

from suite.mail import email_suggestions
from suite.mail.email_suggestions import EmailSuggestions, get_directory_addresses
from suite.mail.email_suggestions.ranking import rank_email_addresses


class Suggestions(UnitTestCase):
    def setUp(self):
        self.index = mock.Mock()
        self.index.get_email_address_hits.return_value = []
        self.directory = []
        self.cards = []
        self.messages = []
        self.client = mock.MagicMock()

        for target, value in (
            ("get_email_address_index", mock.Mock(return_value=self.index)),
            ("get_directory_addresses", lambda: self.directory),
            ("fetch_contact_cards", mock.Mock(side_effect=lambda *args: (self.cards, len(self.cards)))),
            ("get_account_client", mock.Mock(return_value=self.client)),
            ("log_mail_error", mock.Mock()),
        ):
            patcher = mock.patch.object(email_suggestions, target, value)
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)

        batch = self.client.batch.return_value.__enter__.return_value
        batch.mail.email.get.side_effect = lambda **kwargs: mock.Mock(
            result=mock.Mock(items=[mock.Mock(to_wire=mock.Mock(return_value=m)) for m in self.messages])
        )

    def suggest(self, text):
        # A fresh account per call keeps one test's remembered misses out of another's.
        return EmailSuggestions(frappe.generate_hash()).get_suggestions(text)

    def test_directory_user_is_suggested_without_asking_jmap(self):
        self.directory = [{"name": "Jane Doe", "email": "jd@example.com"}]

        self.assertEqual(self.suggest("jane"), [{"name": "Jane Doe", "email": "jd@example.com"}])
        self.fetch_contact_cards.assert_not_called()
        self.get_account_client.assert_not_called()

    def test_directory_entries_that_do_not_match_are_left_out(self):
        self.directory = [{"name": "Jane Doe", "email": "jd@example.com"}]
        self.index.get_email_address_hits.return_value = [{"name": "Jack Ryan", "email": "jack@example.com"}]

        self.assertEqual(self.suggest("jack"), [{"name": "Jack Ryan", "email": "jack@example.com"}])

    def test_address_in_both_sources_is_suggested_once_with_the_known_name(self):
        self.index.get_email_address_hits.return_value = [
            {"name": None, "email": "JD@example.com", "last_sent_at": 100}
        ]
        self.directory = [{"name": "Jane Doe", "email": "jd@example.com"}]

        self.assertEqual(self.suggest("jd"), [{"name": "Jane Doe", "email": "JD@example.com"}])

    def test_someone_written_to_ranks_above_a_colleague_who_ranks_above_a_stranger(self):
        self.directory = [{"name": "Sam Colleague", "email": "sam@acme.example", "is_colleague": True}]
        self.index.get_email_address_hits.return_value = [
            {"name": "Sam Stranger", "email": "sam@spam.example"},
            {"name": "Sam Written", "email": "sam@client.example", "last_sent_at": 100},
        ]

        emails = [suggestion["email"] for suggestion in self.suggest("sam")]
        self.assertEqual(emails, ["sam@client.example", "sam@acme.example", "sam@spam.example"])

    def test_contacts_are_asked_only_when_nothing_local_matches(self):
        self.cards = [
            {"full_name": "Ann Lee", "emails": [{"address": "ann@example.com"}, {"address": "not-an-email"}]}
        ]

        self.assertEqual(self.suggest("ann"), [{"name": "Ann Lee", "email": "ann@example.com"}])
        self.get_account_client.assert_not_called()

    def test_mail_is_asked_only_when_contacts_find_nothing_and_matches_by_name(self):
        self.messages = [
            {
                "from": [{"name": "Priya Raman", "email": "pr@example.com"}],
                "to": [{"name": "Someone Else", "email": "other@example.com"}],
            }
        ]

        self.assertEqual(self.suggest("priya"), [{"name": "Priya Raman", "email": "pr@example.com"}])
        self.fetch_contact_cards.assert_called_once()

    def test_addresses_found_in_mail_are_indexed_for_next_time(self):
        self.messages = [{"cc": [{"name": "Priya Raman", "email": "pr@example.com"}]}]

        self.suggest("priya")

        (addresses,), _kwargs = self.index.index_addresses.call_args
        self.assertEqual([(a["name"], a["email"]) for a in addresses], [("Priya Raman", "pr@example.com")])

    def test_a_query_that_found_nothing_is_not_sent_to_jmap_again(self):
        suggestions = EmailSuggestions(frappe.generate_hash())

        self.assertEqual(suggestions.get_suggestions("nobody"), [])
        self.assertEqual(suggestions.get_suggestions("NoBody "), [])

        self.fetch_contact_cards.assert_called_once()
        self.get_account_client.assert_called_once()

    def test_another_query_is_still_sent_to_jmap_after_a_miss(self):
        suggestions = EmailSuggestions(frappe.generate_hash())

        suggestions.get_suggestions("nobody")
        suggestions.get_suggestions("nobody2")

        self.assertEqual(self.fetch_contact_cards.call_count, 2)

    def test_a_refused_mail_lookup_shows_nothing_and_is_logged(self):
        batch = self.client.batch.return_value.__enter__.return_value
        batch.mail.email.get.side_effect = None
        type(batch.mail.email.get.return_value).result = mock.PropertyMock(
            side_effect=MethodError("serverFail", "c1", {"description": "down"})
        )

        self.assertEqual(self.suggest("priya"), [])
        self.log_mail_error.assert_called_once()

    def test_a_refused_contact_lookup_shows_nothing_and_skips_mail(self):
        self.fetch_contact_cards.side_effect = MethodError("forbidden", "c0", {})

        self.assertEqual(self.suggest("ann"), [])
        self.get_account_client.assert_not_called()
        self.log_mail_error.assert_called_once()

    def test_a_refused_lookup_is_not_remembered_as_a_miss(self):
        suggestions = EmailSuggestions(frappe.generate_hash())
        self.fetch_contact_cards.side_effect = MethodError("serverFail", "c0", {})
        suggestions.get_suggestions("ann")

        self.fetch_contact_cards.side_effect = lambda *args: (self.cards, len(self.cards))
        self.cards = [{"full_name": "Ann Lee", "emails": [{"address": "ann@example.com"}]}]

        self.assertEqual(
            suggestions.get_suggestions("ann"), [{"name": "Ann Lee", "email": "ann@example.com"}]
        )

    def test_blank_query_asks_no_source(self):
        self.assertEqual(self.suggest("   "), [])
        self.index.get_email_address_hits.assert_not_called()
        self.fetch_contact_cards.assert_not_called()


class Ranking(UnitTestCase):
    """``rank_email_addresses`` — the order suggestions are presented in, most relevant first."""

    def rank(self, query, addresses):
        return [address["email"] for address in rank_email_addresses(query, addresses, limit=10)]

    def test_people_written_to_beat_names_that_merely_match_more_tightly(self):
        # "Jo" is the shorter word, but "j" says nothing to prefer it over someone the account writes to.
        jane = {"name": "Jane Doe", "email": "jane@example.com", "last_sent_at": 100}
        jo = {"name": "Jo Smith", "email": "jo@example.org"}
        self.assertEqual(self.rank("j", [jo, jane]), [jane["email"], jo["email"]])

    def test_the_most_recently_written_to_comes_first(self):
        old = {"name": "User Old", "email": "user@example.org", "last_sent_at": 100}
        recent = {"name": "User New", "email": "user@example.com", "last_sent_at": 200}
        self.assertEqual(self.rank("user", [old, recent]), [recent["email"], old["email"]])

    def test_a_complete_word_beats_a_partial_one_even_against_someone_written_to(self):
        doe = {"name": "John Doe", "email": "john@example.com"}
        doeringer = {"name": "Jane Doeringer", "email": "jane@example.com", "last_sent_at": 100}
        self.assertEqual(self.rank("doe", [doeringer, doe]), [doe["email"], doeringer["email"]])

    def test_a_name_match_beats_a_domain_match_even_against_someone_written_to(self):
        named = {"name": "Acme Support", "email": "support@example.com"}
        hosted = {"name": "Jane Doe", "email": "jane@acme.test", "last_sent_at": 100}
        self.assertEqual(self.rank("acme", [hosted, named]), [named["email"], hosted["email"]])

    def test_colleagues_and_contacts_beat_strangers(self):
        stranger = {"name": "Sales Team", "email": "sales@vendor.example"}
        colleague = {"name": "Sam Smith", "email": "sam@acme.example", "is_colleague": True}
        contact = {"name": "Sara Lee", "email": "sara@client.example", "is_contact": True}
        self.assertEqual(self.rank("sa", [stranger, contact, colleague])[-1], stranger["email"])

    def test_mail_that_only_arrives_never_lifts_a_sender(self):
        # Nobody writes to noreply; Nora was written to once.
        noreply = {"name": "GitHub", "email": "noreply@github.com"}
        nora = {"name": "Nora Lee", "email": "nora@example.com", "last_sent_at": 1}
        self.assertEqual(self.rank("no", [noreply, nora]), [nora["email"], noreply["email"]])

    def test_match_details_order_equally_familiar_addresses(self):
        first = {"name": "Doe Jansen", "email": "dj@example.com"}
        later = {"name": "Ann Doe", "email": "ad@example.com"}
        self.assertEqual(self.rank("doe", [later, first]), [first["email"], later["email"]])

    def test_adjacent_terms_beat_scattered_ones(self):
        adjacent = {"name": "Jane Doe", "email": "c@example.com"}
        interrupted = {"name": "Jane Ann Doe", "email": "b@example.com"}
        reversed_ = {"name": "Doe Jane", "email": "a@example.com"}
        self.assertEqual(
            self.rank("jane doe", [reversed_, interrupted, adjacent]),
            [adjacent["email"], interrupted["email"], reversed_["email"]],
        )

    def test_a_match_spanning_name_and_address_sorts_last(self):
        spanning = {"name": "Jane", "email": "doe@example.com", "last_sent_at": 100}
        explained = {"name": "Jane Doelan", "email": "jane.doelan@example.com"}
        self.assertEqual(
            self.rank("jane doe", [spanning, explained]), [explained["email"], spanning["email"]]
        )

    def test_named_then_shorter_addresses_settle_the_rest(self):
        named = {"name": "Jane Doe", "email": "jane.doe@example.com"}
        short = {"name": None, "email": "jane.aoe@example.com"}
        long_ = {"name": None, "email": "jane.abercrombie@example.com"}
        self.assertEqual(
            self.rank("jane", [long_, short, named]), [named["email"], short["email"], long_["email"]]
        )

    def test_results_are_capped_and_carry_only_name_and_email(self):
        addresses = [
            {"name": f"Jan {n}", "email": f"jan{n}@example.com", "last_sent_at": n} for n in range(5)
        ]
        ranked = rank_email_addresses("jan", addresses, limit=2)
        self.assertEqual(
            ranked,
            [{"name": "Jan 4", "email": "jan4@example.com"}, {"name": "Jan 3", "email": "jan3@example.com"}],
        )


class DirectoryAddresses(IntegrationTestCase):
    def setUp(self):
        get_directory_addresses.clear_cache()
        self.addCleanup(get_directory_addresses.clear_cache)

    def create_user(self, first_name, enabled=1):
        email = f"{frappe.generate_hash(length=10)}@directory.example.test"
        frappe.get_doc(
            {"doctype": "User", "email": email, "first_name": first_name, "enabled": enabled}
        ).insert(ignore_permissions=True)
        return email

    def test_lists_enabled_suite_users_by_full_name(self):
        enabled = self.create_user("Directory Enabled")
        disabled = self.create_user("Directory Disabled", enabled=0)

        addresses = {address["email"]: address["name"] for address in get_directory_addresses()}

        self.assertEqual(addresses.get(enabled), "Directory Enabled")
        self.assertNotIn(disabled, addresses)
        self.assertNotIn("Administrator", addresses)

    def listed(self):
        return {address["email"] for address in get_directory_addresses()}

    def commit_after(self, change):
        """Make `change`, check the directory still serves its cached rows, then run what the change
        queued for commit — the test's transaction is rolled back, so it never commits for real."""

        before = self.listed()
        with mock.patch.object(frappe.db, "after_commit", CallbackManager()) as after_commit:
            change()

        self.assertEqual(self.listed(), before)
        after_commit.run()

    def test_new_user_is_listed_once_the_insert_commits(self):
        emails = []
        self.commit_after(lambda: emails.append(self.create_user("Directory New")))

        self.assertIn(emails[0], self.listed())

    def test_disabled_user_is_dropped_once_the_update_commits(self):
        email = self.create_user("Directory Leaver")
        self.assertIn(email, self.listed())

        self.commit_after(
            lambda: frappe.get_doc("User", email).update({"enabled": 0}).save(ignore_permissions=True)
        )

        self.assertNotIn(email, self.listed())

    def test_deleted_user_is_dropped_once_the_delete_commits(self):
        email = self.create_user("Directory Deleted")
        self.assertIn(email, self.listed())

        self.commit_after(lambda: frappe.delete_doc("User", email, ignore_permissions=True, force=True))

        self.assertNotIn(email, self.listed())
