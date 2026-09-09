"""An in-memory Suite Cloud for tests: the site API methods the mail app calls, nothing more.

Objects are keyed by address like the real service; ``call`` dispatches ``module.method`` names
exactly as the client sends them, so the code under test runs unchanged.
"""

from contextlib import contextmanager
from unittest.mock import patch

import frappe

DEFAULT_QUOTA_GB = 5.0


class FakeSuiteCloud:
    def __init__(self) -> None:
        self.domains: dict[str, dict] = {}
        self.accounts: dict[str, dict] = {}
        self.groups: dict[str, dict] = {}
        self.lists: dict[str, dict] = {}
        self.passwords: dict[str, str] = {}
        self.calls: list[tuple[str, dict]] = []

    # --- dispatch ---------------------------------------------------------------------------

    def call(self, method: str, **params):
        self.calls.append((method, params))
        handler = getattr(self, method.replace(".", "__"))
        return handler(**params)

    site_title = "Acme"
    site_contact = "ops@acme.test"

    def update_site_profile(self, title=None, contact_email=None) -> dict:
        if title is not None:
            self.site_title = title.strip() or "acme.frappe.test"
        if contact_email is not None:
            self.site_contact = contact_email.strip().lower() or None
        return self.ping()

    def ping(self) -> dict:
        return {
            "site": "acme.frappe.test",
            "title": self.site_title,
            "status": "Active",
            "enabled": True,
            "cluster": "mail.blr.example.test",
            "mail_hostname": "mail.blr.example.test",
            "jmap_url": "https://mail.test",
            "contact_email": self.site_contact,
            "limits": {
                "max_domains": 10,
                "max_accounts": 500,
                "max_groups": 50,
                "max_mailing_lists": 50,
                "max_disk_gb": 100,
                "default_disk_quota_gb": DEFAULT_QUOTA_GB,
            },
            "usage": {
                "domains": len(self.domains),
                "accounts": len(self.accounts),
                "groups": len(self.groups),
                "mailing_lists": len(self.lists),
                "allocated_disk_gb": sum(a["disk_quota_gb"] for a in self.accounts.values()),
            },
        }

    # --- domains ---------------------------------------------------------------------------

    def domains__list_domains(self) -> list[dict]:
        return [self._domain(d, with_records=False) for d in sorted(self.domains)]

    def domains__get_domain(self, domain: str) -> dict:
        self._require(self.domains, domain)
        return self._domain(domain)

    def domains__check_domain(self, domain: str) -> dict:
        return {
            "domain": domain,
            "ownership_record": {"type": "TXT", "host": "@", "fqdn": domain, "value": "suite-site=tok"},
        }

    def domains__create_domain(self, domain: str, description=None, **_) -> dict:
        if domain in self.domains:
            frappe.throw(f"Domain {domain} already exists.", frappe.ValidationError)
        self.domains[domain] = {"domain": domain, "description": description, "enabled": 1, "is_verified": 0}
        return self._domain(domain)

    def domains__update_domain(self, domain: str, **changes) -> dict:
        d = self._require(self.domains, domain)
        if "enabled" in changes:
            d["enabled"] = int(bool(changes.pop("enabled")))
            if not d["enabled"]:
                d["is_verified"] = 0  # Suite Cloud drops verification with the domain
        if "catch_all_address" in changes:
            changes["catch_all_address"] = changes["catch_all_address"] or None
        if "sub_addressing" in changes:
            changes["sub_addressing"] = int(bool(changes["sub_addressing"]))
        d.update(changes)
        return self._domain(domain)

    def domains__delete_domain(self, domain: str) -> None:
        self._require(self.domains, domain)
        del self.domains[domain]

    def domains__verify_dns_records(self, domain: str) -> dict:
        self._require(self.domains, domain)["is_verified"] = 1
        return {"is_verified": True}

    def domains__get_dns_records(self, domain: str) -> dict:
        self._require(self.domains, domain)
        d = self._domain(domain)
        return {"groups": d["dns_record_groups"], "records": d["dns_records"]}

    def _domain(self, name: str, with_records: bool = True) -> dict:
        d = self.domains[name]
        payload = {
            **d,
            "enabled": bool(d["enabled"]),
            "is_verified": bool(d["is_verified"]),
            "created_at": "2026-09-08 10:00:00",
        }
        if with_records:
            payload["dns_record_groups"] = [
                {
                    "key": "authentication_records",
                    "label": "Email Authentication",
                    "description": "...",
                    "is_mandatory": True,
                },
                {
                    "key": "discovery_records",
                    "label": "Service Discovery",
                    "description": "...",
                    "is_mandatory": False,
                },
            ]
            payload["dns_records"] = [
                {
                    "group": "authentication_records",
                    "category": "SPF",
                    "type": "TXT",
                    "host": "@",
                    "fqdn": name,
                    "value": "v=spf1 include:spf.blr.example.test -all",
                    "priority": 0,
                    "weight": 0,
                    "port": 0,
                    "ttl": 300,
                    "is_mandatory": True,
                    "is_verified": False,
                },
                {
                    "group": "discovery_records",
                    "category": "SRV",
                    "type": "SRV",
                    "host": "_imaps._tcp",
                    "fqdn": f"_imaps._tcp.{name}",
                    "value": "mail.blr.example.test.",
                    "priority": 0,
                    "weight": 1,
                    "port": 993,
                    "ttl": 300,
                    "is_mandatory": False,
                    "is_verified": False,
                },
            ]
        return payload

    # --- accounts ---------------------------------------------------------------------------

    def accounts__list_accounts(self, domain=None, search=None, start=0, limit=50) -> dict:
        emails = sorted(self.accounts)
        return {"items": [self._account(e) for e in emails[start : start + limit]], "total": len(emails)}

    def accounts__get_account(self, email: str) -> dict:
        return self._account(self._require(self.accounts, email)["email"])

    def accounts__create_account(
        self,
        email,
        password,
        display_name=None,
        aliases=None,
        groups=None,
        mailing_lists=None,
        disk_quota_gb=None,
        locale=None,
        time_zone=None,
        **_,
    ) -> dict:
        self._require_active_domain(email)
        if email in self.accounts:
            frappe.throw(f"{email} is already a Mail Account.", frappe.ValidationError)
        if email.split("@", 1)[1] not in self.domains:
            frappe.throw("Domain does not belong to the site.", frappe.ValidationError)
        self.accounts[email] = {
            "email": email,
            "enabled": 1,
            "display_name": display_name,
            "disk_quota_gb": disk_quota_gb or DEFAULT_QUOTA_GB,
            "used_disk_bytes": 0,
            "locale": locale or "en-US",
            "time_zone": time_zone,
            "aliases": [{"email": a, "enabled": True, "description": None} for a in aliases or []],
            "groups": list(groups or []),
        }
        self.passwords[email] = password
        for group in groups or []:
            self._require(self.groups, group)["members"].append(email)
        for mailing_list in mailing_lists or []:
            self._require(self.lists, mailing_list)["recipients"][email] = True
        return {**self._account(email), "app_password": f"apppassword-{email}"}

    def accounts__update_account(self, email, **changes) -> dict:
        self._require(self.accounts, email).update({k: v for k, v in changes.items() if v is not None})
        return self._account(email)

    def accounts__set_account_enabled(self, email, enabled) -> dict:
        self._require(self.accounts, email)["enabled"] = int(bool(enabled))
        return self._account(email)

    def accounts__set_password(self, email, password) -> None:
        self._require(self.accounts, email)
        self.passwords[email] = password

    def accounts__create_app_password(self, email, description="Suite") -> dict:
        self._require(self.accounts, email)
        return {"secret": f"apppassword-{description}"}

    def accounts__set_aliases(self, email, aliases=None) -> dict:
        self._require(self.accounts, email)["aliases"] = self._alias_rows(aliases)
        return self._account(email)

    def accounts__set_groups(self, email, groups=None) -> dict:
        account = self._require(self.accounts, email)
        for group in self.groups.values():
            group["members"] = [m for m in group["members"] if m != email]
        for group in groups or []:
            self._require(self.groups, group)["members"].append(email)
        account["groups"] = list(groups or [])
        return self._account(email)

    def accounts__delete_account(self, email) -> None:
        self._require(self.accounts, email)
        del self.accounts[email]
        self.passwords.pop(email, None)

    def _account(self, email: str) -> dict:
        a = self.accounts[email]
        addresses = {email, *[al["email"] for al in a["aliases"]]}
        return {
            **a,
            "enabled": bool(a["enabled"]),
            "domain": email.split("@", 1)[1],
            "mailing_lists": sorted(n for n, ml in self.lists.items() if addresses & set(ml["recipients"])),
            "created_at": "2026-09-08 10:00:00",
        }

    # --- groups ---------------------------------------------------------------------------------

    def groups__list_groups(self) -> list[dict]:
        return [self._group(g) for g in sorted(self.groups)]

    def groups__get_group(self, email) -> dict:
        return self._group(self._require(self.groups, email)["email"])

    def groups__create_group(
        self, email, description=None, aliases=None, members=None, disk_quota_gb=None
    ) -> dict:
        self._require_active_domain(email)
        if email in self.groups:
            frappe.throw(f"{email} is already a Mail Group.", frappe.ValidationError)
        self.groups[email] = {
            "email": email,
            "description": description,
            "aliases": self._alias_rows(aliases),
            "members": list(members or []),
            "disk_quota_gb": disk_quota_gb or DEFAULT_QUOTA_GB,
        }
        for member in members or []:
            self._require(self.accounts, member)["groups"].append(email)
        return self._group(email)

    def groups__update_group(self, email, **changes) -> dict:
        self._require(self.groups, email).update({k: v for k, v in changes.items() if v is not None})
        return self._group(email)

    def groups__set_group_aliases(self, email, aliases=None) -> dict:
        self._require(self.groups, email)["aliases"] = self._alias_rows(aliases)
        return self._group(email)

    def groups__set_group_members(self, email, members=None) -> dict:
        group = self._require(self.groups, email)
        group["members"] = list(members or [])
        for account in self.accounts.values():
            account["groups"] = [g for g in account["groups"] if g != email]
        for member in group["members"]:
            self._require(self.accounts, member)["groups"].append(email)
        return self._group(email)

    def groups__delete_group(self, email) -> None:
        self._require(self.groups, email)
        del self.groups[email]

    def _group(self, email: str) -> dict:
        g = self.groups[email]
        return {
            **g,
            "domain": email.split("@", 1)[1],
            "members": sorted(g["members"]),
            "created_at": "2026-09-08 10:00:00",
        }

    # --- mailing lists ---------------------------------------------------------------------------

    def mailing_lists__list_mailing_lists(self) -> list[dict]:
        return [self._list(n) for n in sorted(self.lists)]

    def mailing_lists__get_mailing_list(self, email) -> dict:
        return self._list(self._require(self.lists, email)["email"])

    def mailing_lists__create_mailing_list(
        self, email, description=None, aliases=None, recipients=None
    ) -> dict:
        self._require_active_domain(email)
        if email in self.lists:
            frappe.throw(f"{email} is already a Mailing List.", frappe.ValidationError)
        self.lists[email] = {
            "email": email,
            "description": description,
            "aliases": self._alias_rows(aliases),
            "recipients": {r: True for r in recipients or []},
        }
        return self._list(email)

    def mailing_lists__update_mailing_list(self, email, description=None) -> dict:
        if description is not None:
            self._require(self.lists, email)["description"] = description
        return self._list(email)

    def mailing_lists__set_mailing_list_aliases(self, email, aliases=None) -> dict:
        self._require(self.lists, email)["aliases"] = self._alias_rows(aliases)
        return self._list(email)

    def mailing_lists__list_recipients(self, email, search=None, start=0, limit=200) -> dict:
        recipients = self._require(self.lists, email)["recipients"]
        rows = [
            {"email": r, "enabled": bool(v)}
            for r, v in sorted(recipients.items())
            if not search or search in r
        ]
        return {"items": rows[start : start + limit], "total": len(rows)}

    def mailing_lists__add_recipients(self, email, recipients=None) -> dict:
        ml = self._require(self.lists, email)
        added = [r for r in recipients or [] if r not in ml["recipients"]]
        for r in added:
            ml["recipients"][r] = True
        return {"added": added, "recipient_count": len(ml["recipients"])}

    def mailing_lists__remove_recipients(self, email, recipients=None) -> dict:
        ml = self._require(self.lists, email)
        removed = [r for r in recipients or [] if r in ml["recipients"]]
        for r in removed:
            del ml["recipients"][r]
        return {"removed": removed, "recipient_count": len(ml["recipients"])}

    def mailing_lists__set_recipients(self, email, recipients=None) -> dict:
        self._require(self.lists, email)["recipients"] = {r: True for r in recipients or []}
        return self._list(email)

    def mailing_lists__delete_mailing_list(self, email) -> None:
        self._require(self.lists, email)
        del self.lists[email]

    def _list(self, email: str) -> dict:
        ml = self.lists[email]
        return {
            "email": email,
            "domain": email.split("@", 1)[1],
            "description": ml["description"],
            "aliases": ml["aliases"],
            "recipient_count": len(ml["recipients"]),
            "created_at": "2026-09-08 10:00:00",
        }

    # --- meta ----------------------------------------------------------------------------------------

    def meta__get_account_options(self) -> dict:
        return {
            "locales": [{"value": "en-US", "label": "en-US · English"}],
            "time_zones": [{"value": "Asia/Kolkata", "label": "Asia/Kolkata"}],
        }

    # --- helpers ----------------------------------------------------------------------------------

    def _require_active_domain(self, email: str) -> None:
        """Suite Cloud creates objects only on a domain that is enabled and verified."""

        name = email.split("@", 1)[1]
        domain = self.domains.get(name)
        if not domain or not (domain["enabled"] and domain["is_verified"]):
            frappe.throw(
                f"Domain {name} is not active: enable it and verify its DNS records first.",
                frappe.ValidationError,
            )

    @staticmethod
    def _require(store: dict, key: str) -> dict:
        if key not in store:
            frappe.throw(f"{key} not found.", frappe.DoesNotExistError)
        return store[key]

    @staticmethod
    def _alias_rows(aliases) -> list[dict]:
        rows = []
        for a in aliases or []:
            if isinstance(a, dict):
                rows.append(
                    {
                        "email": a["email"],
                        "enabled": bool(a.get("enabled", True)),
                        "description": a.get("description"),
                    }
                )
            else:
                rows.append({"email": a, "enabled": True, "description": None})
        return rows


@contextmanager
def fake_suite_cloud(fake: FakeSuiteCloud | None = None):
    """Routes every Suite Cloud call made by the mail app to ``fake``; yields it."""

    fake = fake or FakeSuiteCloud()
    targets = (
        "suite.mail.suite_cloud.get_client",
        "suite.mail.directory.get_client",
        "suite.mail.api.admin.get_client",
    )
    patches = [patch(target, return_value=fake) for target in targets]
    # User Settings checks the app password against the JMAP server on save; there is none here.
    patches.append(
        patch("suite.mail.doctype.user_settings.user_settings.UserSettings.validate_jmap_settings")
    )
    for p in patches:
        p.start()
    try:
        yield fake
    finally:
        for p in patches:
            p.stop()
