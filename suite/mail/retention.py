# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Trash and Junk retention: the nightly purge behind the mailbox banner.

Trash and Junk carry a banner promising "Items in this mailbox will be automatically
deleted after 30 days" (see `MailboxView.vue`). This module is what makes that true.

JMAP has no "moved to mailbox at" timestamp — an Email only carries `receivedAt`, which
is when the mail arrived, not when it was thrown away. Purging on `receivedAt` would
erase a two-year-old mail the night after a user trashed it, leaving no window to
restore it. So the clock is kept here instead: each run records the first time it
*observed* a message in Trash/Junk, and purges once that stamp is `retention_days()`
old.

Deriving the clock from what is *in* the mailbox (rather than from intercepting moves)
makes it self-healing — it does not care whether the mail was trashed from our UI, over
IMAP, or by another JMAP client, and a restore-then-retrash starts a fresh window
because the stamp is pruned while the message is away. The one cost is a grace period
on the first run after deploy, and after a data store wipe: everything already sitting
in Trash is stamped "now", so nothing is purged for the next 30 days. For a job that
deletes mail, erring toward keeping it too long is the right direction.

Retention defaults to 30 days and is overridable per-site via `mail_trash_retention_days`
in site_config. The floor of one day stops a misconfigured `0` from turning Trash into
an instant hard delete.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import cint, create_batch, get_datetime, now, now_datetime

from suite.mail.doctype.mail_message.mail_message import delete_messages
from suite.mail.jmap import get_email_service, get_mailbox_id_by_role
from suite.mail.store import Entity, get_data_store
from suite.mail.utils import log_mail_error
from suite.mail.utils.logger import get_admin_logger
from suite.store.data_store import DataStore
from suite.utils import enqueue_job

# Mailbox roles the retention window applies to — the two the banner is shown for.
RETENTION_ROLES = ("trash", "junk")

DEFAULT_RETENTION_DAYS = 30
MIN_RETENTION_DAYS = 1

# Message ids pulled from one mailbox in a single run. Ids alone are cheap, so this sits
# far above a realistic Trash; a mailbox past it is reported rather than silently halved.
MAX_MESSAGES_PER_RUN = 10_000

# Accounts purged per long-queue job when sweeping every account.
ACCOUNTS_PER_PURGE_BATCH = 25

# Separates the mailbox id from the message id in a stamp's data store key, so one
# prefix scan pulls back exactly one mailbox's stamps.
KEY_SEPARATOR = ":"


def retention_days() -> int:
	"""Days a message may sit in Trash/Junk before the purge deletes it."""

	configured = frappe.conf.get("mail_trash_retention_days")
	if configured is None:
		return DEFAULT_RETENTION_DAYS

	return max(MIN_RETENTION_DAYS, cint(configured))


def purge_expired_mail() -> None:
	"""Scheduler entry point: fan every JMAP account out into long-queue purge jobs."""

	accounts = frappe.db.get_all("JMAP Account", pluck="name")

	for i, batch in enumerate(create_batch(accounts, ACCOUNTS_PER_PURGE_BATCH)):
		enqueue_job(
			_purge_accounts,
			job_id=f"purge-expired-mail::{i}",
			deduplicate=True,
			queue="long",
			timeout=3600,
			accounts=batch,
		)


def _purge_accounts(accounts: list[str]) -> None:
	"""Purge each account inline, isolating per-account failures.

	One account's unreachable server or missing user must not strand the rest of the batch.
	"""

	for account in accounts:
		try:
			purge_account(account)
		except Exception:
			log_mail_error(
				_("Failed to purge expired mail for account {0}").format(account),
				frappe.get_traceback(with_context=True),
			)


def purge_account(account: str) -> dict:
	"""Purge every retention-managed mailbox of one account.

	Idempotent and safe to re-run. Returns a counter for telemetry.
	"""

	store = get_data_store(account)
	observed_at = now()
	cutoff = now_datetime() - timedelta(days=retention_days())

	purged = 0
	for role in RETENTION_ROLES:
		mailbox_id = get_mailbox_id_by_role(account, role)
		if not mailbox_id:
			continue

		purged += _purge_mailbox(account, store, mailbox_id, observed_at, cutoff)

	return {"purged": purged}


def _purge_mailbox(
	account: str, store: DataStore, mailbox_id: str, observed_at: str, cutoff: datetime
) -> int:
	"""Stamp what is new in one mailbox, prune what has left it, and delete what has expired."""

	logger = get_admin_logger({"account": account, "mailbox_id": mailbox_id})

	service = get_email_service(account, ignore_permissions=True)
	result = service.query({"inMailbox": mailbox_id}, position=0, limit=MAX_MESSAGES_PER_RUN)
	current_ids = result["ids"]

	total = result.get("total")
	if total and total > len(current_ids):
		# The tail beyond the cap keeps its clock unstarted until a later run finds the
		# mailbox thinner. Say so — a silent cap reads as "the whole mailbox was covered".
		logger.warning(
			"retention-scan-truncated", scanned=len(current_ids), total=total, cap=MAX_MESSAGES_PER_RUN
		)

	prefix = f"{mailbox_id}{KEY_SEPARATOR}"
	seen = {
		key.removeprefix(prefix): value for key, value in store.scan(Entity.RETENTION, prefix=prefix).items()
	}

	expired, new_stamps, stale = _reconcile(seen, current_ids, observed_at, cutoff)

	if new_stamps:
		store.set_many(Entity.RETENTION, {f"{prefix}{id}": stamp for id, stamp in new_stamps.items()})

	if stale:
		store.delete_many(Entity.RETENTION, [f"{prefix}{id}" for id in stale])

	if not expired:
		return 0

	logger.info("purging-expired-mail", count=len(expired), retention_days=retention_days())

	# Deliberately not dropping the purged ids' stamps here: the next run sees them gone from
	# the mailbox and prunes them as stale. So a delete that failed server-side keeps its
	# original stamp and is retried, instead of being restamped as new and handed another
	# full window.
	delete_messages(account, expired)

	return len(expired)


def _reconcile(
	seen: dict[str, str], current_ids: list[str], observed_at: str, cutoff: datetime
) -> tuple[list[str], dict[str, str], list[str]]:
	"""Split a mailbox's current contents against the recorded first-seen stamps.

	Returns `(expired, new_stamps, stale)`: the messages first seen before `cutoff` and so due
	for deletion, the messages being seen for the first time and the stamp to record for them,
	and the stamps for messages no longer in the mailbox (restored, moved, or already purged).

	Pure, so the retention matrix can be exercised without a JMAP server or a data store.
	"""

	expired: list[str] = []
	new_stamps: dict[str, str] = {}
	current = set(current_ids)

	for message_id in current_ids:
		stamp = seen.get(message_id)
		if stamp is None:
			new_stamps[message_id] = observed_at
			continue

		try:
			first_seen = get_datetime(stamp)
		except Exception:
			first_seen = None

		if first_seen is None:
			# An unreadable stamp is no basis for deleting mail — restart its clock instead.
			new_stamps[message_id] = observed_at
			continue

		if first_seen < cutoff:
			expired.append(message_id)

	stale = [message_id for message_id in seen if message_id not in current]

	return expired, new_stamps, stale
