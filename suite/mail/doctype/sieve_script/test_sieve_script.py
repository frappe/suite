# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import operator
import re
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

# import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]

# RFC 5231 relational match types.
RELATIONS = {
    "gt": operator.gt,
    "ge": operator.ge,
    "lt": operator.lt,
    "le": operator.le,
    "eq": operator.eq,
    "ne": operator.ne,
}


# One branch of the gate: `if|elsif <test> { fileinto [tags] "<mailbox>"; stop; }`, the mailbox an
# RFC 5228 quoted string.
GATE_BRANCH = re.compile(
    r'\s*(?:if|elsif) (.+?) \{\s*fileinto ((?::\w+ )*)"((?:[^"\\]|\\.)*)";\s*stop;\s*\}', re.DOTALL
)


def render_screening_gate(
    accepted_emails: list[str], own_emails: list[str] | None = None, screener: str = "Screener"
) -> str:
    """Render the Screening gate with the mailbox and identity lookups (JMAP calls) stubbed out."""

    from suite.mail.doctype.sieve_script import sieve_script

    own_emails = ["me@own.example"] if own_emails is None else own_emails
    with (
        patch.object(sieve_script, "get_screening_mailbox_path", return_value=screener),
        patch.object(sieve_script, "get_inbox_mailbox_path", return_value="INBOX"),
        patch.object(sieve_script, "get_account_emails", return_value=own_emails),
    ):
        return sieve_script.build_screening_gate("account", accepted_emails)


def parse_gate(gate: str) -> list[tuple[str, list[str], str]]:
    """Split the rendered gate into its (test, fileinto tags, mailbox) branches, in order.

    Fails on anything else in the gate — an `else` branch, a trailing statement — rather than skip it.
    """

    header, _, body = gate.partition("\n")
    assert header == "# Screening", gate

    branches, pos = [], 0
    while match := GATE_BRANCH.match(body, pos):
        test, tags, mailbox = match.groups()
        branches.append((test, tags.split(), re.sub(r"\\(.)", r"\1", mailbox)))
        pos = match.end()

    assert branches and not body[pos:].strip(), f"Unparsed Sieve in the gate:\n{body[pos:]}"
    return branches


def route_through_gate(gate: str, sender: str, spamtest: int) -> str | None:
    """Evaluate the rendered gate for one message with RFC 5228/5231/5235 semantics.

    Returns the mailbox the gate files the message into, or None when no branch matches — an
    implicit keep, where the server's own filtering picks the mailbox. Understands only the tests the
    gate emits, and fails on anything else rather than guess.
    """

    def evaluate(test: str) -> bool:
        test = test.strip()
        if test.startswith("anyof"):
            # Every member is evaluated, so one this helper can't read fails even after a match.
            results = [evaluate(t) for t in test[test.index("(") + 1 : test.rindex(")")].split(",")]
            return any(results)
        if test.startswith("not "):
            return not evaluate(test[4:])
        if match := re.fullmatch(r'address :is "from" "(.+)"', test):
            return sender.lower() == match[1].lower()
        if match := re.fullmatch(r'address :domain :is "from" "(.+)"', test):
            return sender.rpartition("@")[2].lower() == match[1].lower()
        if match := re.fullmatch(r'spamtest :value "(\w+)" :comparator "i;ascii-numeric" "(\d+)"', test):
            return RELATIONS[match[1]](spamtest, int(match[2]))
        raise AssertionError(f"Unrecognised Sieve test: {test}")

    return next((mailbox for test, _tags, mailbox in parse_gate(gate) if evaluate(test)), None)


def run_rebuild_jobs(accounts: list[str], build, refuse=lambda job: False, queue_wait: float = 0):
    """Rebuild the accounts through their background jobs, run one after another as a worker would,
    with `build` standing in for `build_automation_sieve`, a queue that refuses the jobs `refuse`
    picks, as a full one does, and a clock that moves `queue_wait` seconds while each job waits in the
    queue. Returns each job's arguments with the accounts it rebuilt and the seconds it slept, the
    most jobs ever waiting in the queue at once, and the failure log."""

    import frappe

    from suite.mail.doctype.sieve_script import sieve_script

    queue, jobs, most_queued, now = [], [], 0, 1_000_000.0
    running_job_id = None

    def sleep(seconds):
        nonlocal now
        jobs[-1]["slept"] += seconds
        now += seconds

    def enqueue_job(method, **kwargs):
        nonlocal most_queued
        if refuse(kwargs):
            raise frappe.QueueOverloaded("Too many queued background jobs")
        # Frappe skips a deduplicated job while one with its id is queued or running.
        job_id = kwargs.get("job_id")
        if kwargs.get("deduplicate") and job_id in {running_job_id, *(job.get("job_id") for job in queue)}:
            return
        queue.append(kwargs)
        most_queued = max(most_queued, len(queue))

    def recorded_build(account, **kwargs):
        jobs[-1]["rebuilt"].append(account)
        build(account, **kwargs)

    with (
        patch.object(frappe.local.db, "exists", return_value=True),
        patch.object(sieve_script, "get_enabled_account_user", return_value="Administrator"),
        patch.object(sieve_script, "build_automation_sieve", side_effect=recorded_build),
        patch.object(sieve_script, "enqueue_job", side_effect=enqueue_job),
        patch.object(sieve_script, "time", SimpleNamespace(time=lambda: now, sleep=sleep)),
        patch.object(sieve_script, "log_mail_error") as log_mail_error,
    ):
        sieve_script.enqueue_automation_sieve_rebuilds(accounts, job_id_prefix="test")
        while queue:
            job = queue.pop(0)
            running_job_id = job.get("job_id")
            jobs.append({**job, "rebuilt": [], "slept": 0})
            now += queue_wait
            sieve_script._rebuild_automation_sieves(
                job["accounts"], job["failures"], job["attempt"], job["not_before"]
            )

    return jobs, most_queued, log_mail_error


class IntegrationTestSieveScript(IntegrationTestCase):
    """
    Integration tests for SieveScript.
    Use this class for testing interactions between multiple components.
    """

    def test_screening_gate_screens_all_mail_the_server_does_not_call_spam(self):
        """Mail from an unaccepted sender goes to the Screener unless Stalwart calls it spam.

        Stalwart hands the script a spamtest value (RFC 5235) of 0 when it did not score the message,
        1-4 for ham (1 at a score of about zero or below, rising towards the spam threshold) and 5-10
        for spam. Spam is left to the server, which files it into Junk. Ham with a small positive
        score must be screened too: letting it fall through delivered it straight to the Inbox.
        """

        gates = {
            "nothing trusted": render_screening_gate([], own_emails=[]),
            "own identities only": render_screening_gate([]),
            "accepted senders": render_screening_gate(["boss@work.example", "@partner.example"]),
        }
        for shape, gate in gates.items():
            for spamtest in range(11):
                with self.subTest(shape=shape, spamtest=spamtest):
                    expected = "Screener" if spamtest < 5 else None
                    self.assertEqual(route_through_gate(gate, "stranger@else.example", spamtest), expected)

    def test_screening_gate_delivers_trusted_senders_to_the_inbox(self):
        gate = render_screening_gate(["boss@work.example", "@partner.example"])

        # Accepted addresses and domains, and the account's own identities, skip the Screener at
        # every spam score.
        for sender in ("boss@work.example", "anyone@partner.example", "me@own.example"):
            for spamtest in range(11):
                with self.subTest(sender=sender, spamtest=spamtest):
                    self.assertEqual(route_through_gate(gate, sender, spamtest), "INBOX")

        # A subdomain of an accepted domain is a different domain.
        self.assertEqual(route_through_gate(gate, "someone@info.partner.example", 1), "Screener")

    def test_screening_gate_creates_a_missing_screener(self):
        """Stalwart files into the Inbox when a `fileinto` target does not exist, so the Screener
        branch creates it on delivery instead (RFC 5490 `:create`)."""

        from suite.mail.doctype.sieve_script.sieve_script import AUTOMATION_SCRIPT_REQUIRE

        for own_emails in ([], ["me@own.example"]):
            with self.subTest(own_emails=own_emails):
                branches = parse_gate(render_screening_gate([], own_emails=own_emails))
                screener_tags = [tags for _test, tags, mailbox in branches if mailbox == "Screener"]
                self.assertEqual(screener_tags, [[":create"]])

        # RFC 5228: a script using an extension it does not require fails to compile, and the account
        # keeps its previous script. `:create` needs "mailbox", `:value` "relational".
        required = set(re.findall(r'"([^"]+)"', AUTOMATION_SCRIPT_REQUIRE))
        self.assertLessEqual(
            {"fileinto", "mailbox", "spamtest", "relational", "comparator-i;ascii-numeric"}, required
        )

    def test_rebuild_retries_accounts_that_fail(self):
        """A rebuild that fails — the mail server briefly unreachable — is retried, since nothing else
        rebuilds the account until its user next changes a rule. Only one that keeps failing is logged."""

        attempts = Counter()

        def build(account, raise_exception=False, **kwargs):
            # A failed build is only logged unless the caller asks for the exception.
            attempts[account] += 1
            if raise_exception and (account == "down" or (account == "flaky" and attempts[account] == 1)):
                raise ConnectionError("Mail server unreachable")

        jobs, _most_queued, log_mail_error = run_rebuild_jobs(["ok", "flaky", "down"], build)

        self.assertEqual(attempts["ok"], 1)
        self.assertEqual(attempts["flaky"], 2)
        self.assertGreater(attempts["down"], 2)
        # Each retry waits first, once, and the first pass never does.
        waits = [job for job in jobs if job["slept"] > 0]
        self.assertEqual(len(waits), attempts["down"] - 1)
        self.assertTrue(all(job["attempt"] for job in waits))
        self.assertEqual(log_mail_error.call_count, 1)
        self.assertIn("JMAP account down", str(log_mail_error.call_args))

    def test_a_retry_counts_its_time_in_the_queue_as_waiting(self):
        """A job asleep holds a worker that could serve other queues, so a retry that has already
        waited in the queue as long as it should does not sleep again."""

        attempts = Counter()

        def build(account, raise_exception=False, **kwargs):
            attempts[account] += 1
            if raise_exception and account == "down":
                raise ConnectionError("Mail server unreachable")

        jobs, _most_queued, log_mail_error = run_rebuild_jobs(["down"], build, queue_wait=3600)

        self.assertGreater(attempts["down"], 2)
        self.assertEqual(sum(job["slept"] for job in jobs), 0)
        self.assertEqual(log_mail_error.call_count, 1)

    def test_rebuild_reads_each_account_in_a_job_of_its_own(self):
        """Every job opens its own database transaction. A job serving several accounts would read the
        later ones' rules from the snapshot its first read took — before a user changed them — and
        replace the user's newer script with a stale one."""

        from suite.mail.doctype.sieve_script.sieve_script import _ACCOUNTS_PER_REBUILD_BATCH

        accounts = [f"account-{i}" for i in range(150)]
        rebuilt = Counter()
        jobs, most_queued, log_mail_error = run_rebuild_jobs(
            accounts, lambda account, **kwargs: rebuilt.update([account])
        )

        self.assertEqual(rebuilt, Counter(accounts))
        self.assertEqual({len(job["rebuilt"]) for job in jobs}, {1})
        # The accounts still to come wait in each batch's chain, not in the queue, which refuses new
        # jobs past a limit.
        self.assertLessEqual(most_queued, -(-len(accounts) // _ACCOUNTS_PER_REBUILD_BATCH))
        log_mail_error.assert_not_called()

    def test_a_rebuild_that_times_out_still_passes_the_chain_on(self):
        """A job's timeout surfaces inside it as an exception. The job must still queue the accounts
        after it, or they would never be rebuilt, retried or logged."""

        from rq.timeouts import JobTimeoutException

        def build(account, raise_exception=False, **kwargs):
            if raise_exception and account == "slow":
                raise JobTimeoutException("Task exceeded maximum timeout value")

        jobs, _most_queued, log_mail_error = run_rebuild_jobs(["slow", "next"], build)

        self.assertIn("next", [account for job in jobs for account in job["rebuilt"]])
        self.assertEqual(log_mail_error.call_count, 1)
        self.assertIn("JMAP account slow", str(log_mail_error.call_args))

    def test_a_rebuild_does_not_use_mailboxes_cached_by_an_earlier_job(self):
        """A worker that doesn't fork per job keeps its mailbox cache from job to job, for up to an
        hour. A rebuild must read the folders as they are, or it files rules into renamed ones."""

        from suite.mail.jmap.services.core import CoreService

        CoreService._cache["account"] = {"mailboxes": [{"id": "m1", "_name": "Old name"}]}
        self.addCleanup(CoreService._cache.pop, "account", None)

        cached_at_build = []
        run_rebuild_jobs(
            ["account"], lambda account, **kwargs: cached_at_build.append(CoreService._cache.get(account))
        )

        self.assertEqual(cached_at_build, [None])

    def test_a_chain_that_cannot_queue_its_next_job_logs_what_it_held(self):
        """A full queue, or Redis failing, refuses a chain's next job and ends the chain. The accounts
        it would have rebuilt and the failures it carried must be logged, not dropped with it."""

        def build(account, raise_exception=False, **kwargs):
            if raise_exception and account == "down":
                raise ConnectionError("Mail server unreachable")

        def logged(log_mail_error) -> dict[str, str]:
            messages = [call.args[1] for call in log_mail_error.call_args_list]
            return {message.split("JMAP account ")[1].split("\n")[0]: message for message in messages}

        refusals = {
            "the rest of the batch": lambda job: job["accounts"][0] == "c",
            "a retry": lambda job: job["attempt"] == 1,
        }
        expected = {"the rest of the batch": {"down", "c", "d"}, "a retry": {"down"}}
        for case, refuse in refusals.items():
            with self.subTest(refused=case):
                _jobs, _most_queued, log_mail_error = run_rebuild_jobs(["down", "b", "c", "d"], build, refuse)

                logs = logged(log_mail_error)
                self.assertEqual(set(logs), expected[case])
                # A failed rebuild is logged with its own traceback, not the queue's.
                self.assertIn("Mail server unreachable", logs["down"])
                if "c" in logs:
                    self.assertIn("QueueOverloaded", logs["c"])

    def test_mailbox_paths_survive_quotes_and_backslashes(self):
        """One malformed string fails the whole script upload, leaving the account on its old script."""

        from suite.mail.doctype.sieve_script.sieve_script import rule_object_to_sieve

        path = 'Clients/"VIP" \\ Gold'

        gate = render_screening_gate([], screener=path)
        self.assertEqual(route_through_gate(gate, "stranger@else.example", 1), path)

        rule = rule_object_to_sieve({"emails_from": "boss@work.example"}, path)
        self.assertIn('fileinto "Clients/\\"VIP\\" \\\\ Gold";', rule)

    def test_sender_match_condition(self):
        from suite.mail.doctype.sieve_script.sieve_script import _sender_match_condition

        # A plain email matches the full From address.
        self.assertEqual(
            _sender_match_condition("john@example.com"),
            'address :is "from" "john@example.com"',
        )
        # A '@domain' entry matches every sender from that domain via the :domain address part.
        self.assertEqual(
            _sender_match_condition("@example.com"),
            'address :domain :is "from" "example.com"',
        )
        # Blank / bare '@' values produce no condition.
        self.assertIsNone(_sender_match_condition(""))
        self.assertIsNone(_sender_match_condition("   "))
        self.assertIsNone(_sender_match_condition("@"))

    def test_build_screening_block_with_domain(self):
        from suite.mail.doctype.sieve_script.sieve_script import _build_screening_block

        # A mix of an address and a domain OR-es both address tests inside a single anyof block.
        block = _build_screening_block(
            "Rejected Emails", ["spammer@bad.com", "@bad-domain.io"], ["  discard;", "  stop;"]
        )
        self.assertIn('address :is "from" "spammer@bad.com"', block)
        self.assertIn('address :domain :is "from" "bad-domain.io"', block)
        self.assertIn("if anyof (", block)
        self.assertIn("# Rejected Emails", block)

    def test_remove_sieve_block_removes_multi_stop_block(self):
        from suite.mail.doctype.sieve_script.sieve_script import remove_sieve_block

        # The Screening gate is an if/elsif block with two `stop;` statements; removal must strip the
        # whole thing, not just up to the first `stop;`.
        script = (
            'require ["fileinto"];\n\n'
            "# Screening\n"
            'if address :is "from" "boss@work.com" {\n'
            '  fileinto "INBOX";\n'
            "  stop;\n"
            "}\n"
            'elsif not spamtest :value "ge" :comparator "i;ascii-numeric" "5" {\n'
            '  fileinto :create "Screener";\n'
            "  stop;\n"
            "}\n"
        )

        result = remove_sieve_block(script, "Screening")

        self.assertNotIn("# Screening", result)
        self.assertNotIn("elsif", result)
        self.assertNotIn("Screener", result)
        self.assertIn('require ["fileinto"];', result)

    def test_remove_sieve_block_preserves_following_block(self):
        from suite.mail.doctype.sieve_script.sieve_script import remove_sieve_block

        script = (
            "# Rejected Emails\n"
            'if address :is "from" "x@bad.com" {\n'
            "  discard;\n"
            "  stop;\n"
            "}\n\n"
            "# Mailbox: Work\n"
            'if address :is "from" "team@work.com" {\n'
            '  fileinto "Work";\n'
            "  stop;\n"
            "}\n"
        )

        result = remove_sieve_block(script, "Rejected Emails")

        self.assertNotIn("# Rejected Emails", result)
        self.assertNotIn("x@bad.com", result)
        self.assertIn("# Mailbox: Work", result)
        self.assertIn("team@work.com", result)
