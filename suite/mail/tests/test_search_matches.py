# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Reading why a search matched. The snippets here are as Stalwart returned them for real mail."""

from unittest.mock import MagicMock, patch

from frappe.tests import UnitTestCase

from suite.mail import search_matches
from suite.mail.search_matches import (
    found_in_attachment,
    get_snippets,
    has_terms,
    marked_words,
    matching_messages,
    parse_snippet,
)


def hits(segments: list[dict]) -> list[str]:
    return [segment["text"] for segment in segments if segment["hit"]]


def text(segments: list[dict]) -> str:
    return "".join(segment["text"] for segment in segments)


class FakeBatch:
    """Records the calls of a JMAP batch and answers each from `answer`."""

    def __init__(self, answer=None, error=None):
        self.calls = []
        self.error = error
        self.answer = answer
        self.mail = MagicMock()
        self.mail.search_snippet.get.side_effect = self.search_snippet_get
        self.mail.email.query.side_effect = self.email_query
        self.mail.email.get.return_value.result.items = []

    def __enter__(self):
        if self.error:
            raise self.error
        return self

    def __exit__(self, *_):
        return False

    def search_snippet_get(self, filter, email_ids):
        self.calls.append(list(email_ids))
        handle = MagicMock()
        handle.result.items = [self.answer(id) for id in email_ids]
        return handle

    def email_query(self, **kwargs):
        self.calls.append(kwargs)
        return MagicMock()


def client_with(batch: FakeBatch) -> MagicMock:
    client = MagicMock()
    client.batch.return_value = batch
    return client


def snippet_item(id: str, subject=None, preview=None) -> MagicMock:
    item = MagicMock()
    item.email_id, item.subject, item.preview = id, subject, preview
    return item


class TestParseSnippet(UnitTestCase):
    def test_marked_words_are_cut_out_of_the_text(self):
        segments = parse_snippet("The <mark>zebrafinch</mark> <mark>answer</mark> is yes ")
        self.assertEqual(hits(segments), ["zebrafinch", "answer"])
        self.assertEqual(text(segments), "The zebrafinch answer is yes")

    def test_what_the_mail_wrote_comes_back_as_text_not_markup(self):
        segments = parse_snippet(
            "A &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; "
            "<mark>word</mark> &lt;mark&gt;fake&lt;/mark&gt; 5 &gt; 3 &amp;amp; done"
        )
        self.assertEqual(hits(segments), ["word"])
        self.assertEqual(
            text(segments), 'A <script>alert(1)</script> & "quoted" word <mark>fake</mark> 5 > 3 &amp; done'
        )

    def test_no_snippet_is_no_segments(self):
        self.assertIsNone(parse_snippet(None))
        self.assertIsNone(parse_snippet(""))


class TestHasTerms(UnitTestCase):
    def test_words_anywhere_in_the_filter_count(self):
        self.assertTrue(has_terms({"operator": "AND", "conditions": [{"from": "a"}, {"text": "b"}]}))
        self.assertTrue(has_terms({"subject": "b"}))

    def test_a_search_by_sender_and_date_has_no_words_to_mark(self):
        self.assertFalse(has_terms({"operator": "AND", "conditions": [{"from": "a"}, {"after": "d"}]}))

    def test_words_being_ruled_out_arent_words_to_mark(self):
        self.assertFalse(has_terms({"operator": "NOT", "conditions": [{"text": "b"}]}))


WORD_SEARCH = {"operator": "AND", "conditions": [{"text": "word"}]}
INVOICE_SNIPPET = {"subject": None, "preview": parse_snippet("<mark>Invoice</mark> number 12")}


class TestGetSnippets(UnitTestCase):
    def snippets(self, batch: FakeBatch, ids: list[str], filter=None):
        with patch.object(search_matches, "get_account_client", return_value=client_with(batch)):
            return get_snippets("account", filter or WORD_SEARCH, ids)

    def test_a_message_without_the_words_has_no_snippet(self):
        def answer(id):
            return snippet_item(id, preview="<mark>word</mark>") if id == "a" else snippet_item(id)

        result = self.snippets(FakeBatch(answer), ["a", "b"])
        self.assertEqual(list(result), ["a"])
        self.assertEqual(hits(result["a"]["preview"]), ["word"])

    def test_more_ids_than_the_server_takes_are_asked_for_in_turns(self):
        batch = FakeBatch(lambda id: snippet_item(id, preview="<mark>word</mark>"))
        ids = [f"m{i}" for i in range(230)]
        result = self.snippets(batch, ids)
        self.assertLessEqual(max(len(call) for call in batch.calls), 100)
        self.assertEqual(sorted(result), sorted(ids))

    def test_no_words_to_mark_is_no_call_at_all(self):
        batch = FakeBatch(lambda id: snippet_item(id))
        self.assertEqual(self.snippets(batch, ["a"], filter={"from": "ana"}), {})
        self.assertEqual(batch.calls, [])

    def test_a_failed_call_leaves_the_results_without_their_words(self):
        error = search_matches.MailServerUnavailableError()
        with (
            patch.object(search_matches.frappe, "log_error"),
            patch.object(search_matches.frappe, "get_traceback", return_value=""),
        ):
            self.assertEqual(self.snippets(FakeBatch(error=error), ["a"]), {})


class TestMatchingMessages(UnitTestCase):
    def listed(self, emails: list[dict], newest: dict[str, str]):
        batch = FakeBatch()
        batch.mail.email.get.return_value.result.items = [
            MagicMock(to_wire=MagicMock(return_value=email)) for email in emails
        ]
        with patch.object(search_matches, "get_account_client", return_value=client_with(batch)):
            return matching_messages("account", {"text": "word"}, newest), batch

    def test_only_the_pages_conversations_are_kept_in_the_order_listed(self):
        emails = [
            {"id": "r", "threadId": "t"},
            {"id": "x", "threadId": "elsewhere"},
            {"id": "q", "threadId": "t"},
        ]
        (found, saw_all), _ = self.listed(emails, {"t": "r"})
        self.assertEqual(found, {"t": ["r", "q"]})
        self.assertTrue(saw_all)

    def test_it_starts_from_the_top_of_the_page_uncollapsed(self):
        _, batch = self.listed([], {"t": "r", "u": "s"})
        self.assertEqual(batch.calls[0]["anchor"], "r")
        self.assertFalse(batch.calls[0]["collapseThreads"])

    def test_a_full_window_doesnt_claim_to_have_seen_everything(self):
        emails = [{"id": f"m{i}", "threadId": "t"} for i in range(search_matches.MATCH_WINDOW)]
        (_, saw_all), _ = self.listed(emails, {"t": "m0"})
        self.assertFalse(saw_all)


class TestFoundInAttachment(UnitTestCase):
    def test_words_the_body_doesnt_hold_came_from_the_attachment(self):
        mail = {"text_body": "See the file.", "attachments": [{"filename": "notes.txt"}]}
        self.assertTrue(found_in_attachment(mail, INVOICE_SNIPPET))

    def test_words_the_body_holds_are_the_bodys(self):
        mail = {"html_body": "<p>The invoice is due</p>", "attachments": [{"filename": "notes.txt"}]}
        self.assertFalse(found_in_attachment(mail, INVOICE_SNIPPET))

    def test_a_mail_with_no_attachment_is_never_said_to_have_one(self):
        self.assertFalse(found_in_attachment({"text_body": "x", "attachments": []}, INVOICE_SNIPPET))


class TestMarkedWords(UnitTestCase):
    def test_the_words_come_as_the_mail_spells_them(self):
        snippet = {
            "subject": parse_snippet("<mark>Budget</mark> planning"),
            "preview": parse_snippet("the <mark>budgets</mark> are in"),
        }
        self.assertEqual(marked_words(snippet), ["Budget", "budgets"])
