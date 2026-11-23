from datetime import UTC, datetime

import frappe
from frappe import _
from frappe.utils import create_batch

from suite.mail.store import Entity, get_data_store
from suite.mail.utils import log_mail_error
from suite.utils import enqueue_job

BYTES_PER_MB = 1024 * 1024

# Records per read or write, bounding memory and how long the LMDB writer lock is held.
_BATCH_SIZE = 500

_ACCOUNTS_PER_JOB = 25


def enforce_message_cache_quotas() -> None:
    """Fan every account with a quota out into long-queue jobs."""

    accounts = frappe.db.get_all(
        "JMAP Account",
        filters={"message_cache_quota_mb": [">", 0]},
        fields=["name", "message_cache_quota_mb"],
        as_list=True,
    )
    for i, batch in enumerate(create_batch(accounts, _ACCOUNTS_PER_JOB)):
        enqueue_job(
            enforce_quotas,
            job_id=f"enforce-message-cache-quotas::{i}",
            deduplicate=True,
            queue="long",
            timeout=3600,
            quotas=dict(batch),
        )


def enforce_quotas(quotas: dict[str, int]) -> None:
    """Enforce each account's quota in MB, one account's failure not stopping the rest."""

    for account, quota_mb in quotas.items():
        try:
            MessageCacheQuota(account).enforce(quota_mb)
        except Exception:
            log_mail_error(
                _("Failed to enforce message cache quota for account {0}").format(account),
                frappe.get_traceback(with_context=True),
            )


def record_message_access(account: str, ids: list[str]) -> None:
    """Note that these messages were read. Never breaks the read."""

    try:
        MessageCacheQuota(account).record_access(ids)
    except Exception:
        log_mail_error(_("Failed to record message access"), frappe.get_traceback(with_context=True))


class MessageCacheQuota:
    """Keeps an account's cached messages within a size, evicting the least recently accessed."""

    def __init__(self, account: str) -> None:
        self.store = get_data_store(account)

    def record_access(self, ids: list[str]) -> None:
        """Stamp messages with today. Eviction is daily, so a day is precise enough and each
        message costs at most one write a day."""

        today = datetime.now(UTC).date().isoformat()
        stamps = self.store.get_many(Entity.EMAIL_ACCESS, ids)
        if stale := {id: today for id, stamp in stamps.items() if stamp != today}:
            self.store.set_many(Entity.EMAIL_ACCESS, stale)

    def enforce(self, quota_mb: int) -> int:
        """Evict down to `quota_mb` and return how many messages went."""

        # Stamps first: a message is cached before it is stamped, so any stamp without a message
        # in the later read really has lost its message.
        stamps = self.store.scan(Entity.EMAIL_ACCESS)
        sizes = self.store.get_value_sizes(Entity.EMAIL)
        self.store.delete_many(Entity.EMAIL_ACCESS, [id for id in stamps if id not in sizes])

        excess = sum(sizes.values()) - quota_mb * BYTES_PER_MB
        if excess <= 0:
            return 0

        stamps |= self.backfill_stamps([id for id in sizes if id not in stamps])
        victims = self.get_eviction_candidates(sizes, stamps, excess)
        for batch in create_batch(victims, _BATCH_SIZE):
            self.store.delete_many(Entity.EMAIL, batch)
            self.store.delete_many(Entity.EMAIL_ACCESS, batch)

        return len(victims)

    def backfill_stamps(self, ids: list[str]) -> dict[str, str]:
        """Date messages cached before access tracking by when they arrived."""

        stamps: dict[str, str] = {}
        for batch in create_batch(ids, _BATCH_SIZE):
            messages = self.store.get_many(Entity.EMAIL, batch)
            found = {id: (m.get("received_at") or "")[:10] for id, m in messages.items() if m}
            self.store.set_many(Entity.EMAIL_ACCESS, found)
            stamps |= found

        return stamps

    def get_eviction_candidates(
        self, sizes: dict[str, int], stamps: dict[str, str], excess: int
    ) -> list[str]:
        """The oldest-accessed messages that together free at least `excess` bytes."""

        victims = []
        for id in sorted(sizes, key=lambda id: (stamps.get(id, ""), id)):
            if excess <= 0:
                break

            victims.append(id)
            excess -= sizes[id]

        return victims
