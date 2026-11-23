"""Stalwart's management API, as the admin in the `mail` site config. For development only.

The Northwind demo seed and the local Suite Cloud (suite.mail.dev_suite_cloud) use it to make
domains, accounts and app passwords on a bench's own Stalwart, which Suite Cloud does in production.
"""

from typing import Self

import frappe
import httpx

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
CALENDARS = "urn:ietf:params:jmap:calendars"
MANAGEMENT = "urn:stalwart:jmap"


class Stalwart:
    """Stalwart's management API as the configured admin, and each account's JMAP through it."""

    def __init__(self) -> None:
        conf = frappe.conf.mail or {}
        if not (conf.get("server_url") and conf.get("username") and conf.get("password")):
            frappe.throw("The `mail` site config needs server_url, username and password for Stalwart.")
        self.url = conf["server_url"].rstrip("/")
        self.admin = conf["username"]
        self.password = conf["password"]
        self.http = httpx.Client(timeout=60, verify=bool(conf.get("verify_ssl")), follow_redirects=True)
        self.account = self.get_session(self.admin)["primaryAccounts"][MANAGEMENT]

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_exception: object) -> None:
        self.http.close()

    def get_session(self, login: str) -> dict:
        response = self.http.get(f"{self.url}/.well-known/jmap", auth=(login, self.password))
        response.raise_for_status()
        return response.json()

    def call(self, login: str, method: str, arguments: dict) -> dict:
        using = [CORE, MANAGEMENT] if method.startswith("x:") else [CORE, MAIL, CALENDARS]
        body = {"using": using, "methodCalls": [[method, arguments, "0"]]}
        response = self.http.post(f"{self.url}/jmap/", json=body, auth=(login, self.password))
        response.raise_for_status()
        name, result, _call = response.json()["methodResponses"][0]
        if name == "error":
            raise RuntimeError(f"{method} failed: {result}")
        failures = {
            key: result[key] for key in ("notCreated", "notUpdated", "notDestroyed") if result.get(key)
        }
        if failures:
            raise RuntimeError(f"{method} failed: {failures}")
        return result

    def manage(self, object_type: str, action: str, **arguments) -> dict:
        return self.call(self.admin, f"x:{object_type}/{action}", {"accountId": self.account, **arguments})

    def get_all(self, object_type: str) -> list[dict]:
        return self.manage(object_type, "get")["list"]

    def create(self, object_type: str, payload: dict) -> str:
        return self.manage(object_type, "set", create={"new": payload})["created"]["new"]["id"]

    def get_domain_id(self, domain: str) -> str | None:
        return next((row["id"] for row in self.get_all("Domain") if row["name"] == domain), None)

    def get_account_id(self, email: str) -> str | None:
        return next((row["id"] for row in self.get_all("Account") if row.get("emailAddress") == email), None)

    def create_app_password(self, email: str, description: str) -> str:
        login = self.as_account(email)
        account = self.get_session(login)["primaryAccounts"][MANAGEMENT]
        payload = {"description": description, "permissions": {"@type": "Inherit"}}
        result = self.call(login, "x:AppPassword/set", {"accountId": account, "create": {"new": payload}})
        return result["created"]["new"]["secret"]

    def as_account(self, email: str) -> str:
        """The master-user login: the admin acting as `email`."""
        return f"{email}%{self.admin}"
