import uuid

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.content import conversions
from suite.content.patches.retry_over_quota_conversions import execute

APPS = ("writer", "slides", "sheets")
OUTCOMES = ("over_quota", "too_large", "child_crash", "converted")


class RetryOverQuotaConversions(IntegrationTestCase):
    """A full Drive no longer refuses a conversion, so its old over_quota refusals are cleared to run again."""

    def setUp(self) -> None:
        self.nodes: dict[tuple[str, str], str] = {}
        for app in APPS:
            for outcome in OUTCOMES:
                self.nodes[app, outcome] = f"retry-{uuid.uuid4().hex[:12]}"

        self.addCleanup(self.delete_records)
        for (app, outcome), node in self.nodes.items():
            conversions.record(app, node, "fingerprint", now_datetime(), outcome)

        frappe.db.commit()

    def delete_records(self) -> None:
        for (app, _outcome), node in self.nodes.items():
            frappe.db.sql(f"DELETE FROM `__{app}_content_conversion` WHERE `node` = %s", node)

        frappe.db.commit()

    def outcome(self, app: str, node: str) -> list[str]:
        return frappe.db.sql_list(
            f"SELECT `outcome` FROM `__{app}_content_conversion` WHERE `node` = %s", node
        )

    def test_clears_every_apps_over_quota_records_and_leaves_other_outcomes(self) -> None:
        execute()

        for (app, outcome), node in self.nodes.items():
            kept = outcome != "over_quota"
            self.assertEqual(self.outcome(app, node), [outcome] * kept, msg=(app, outcome))
