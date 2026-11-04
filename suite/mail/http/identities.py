"""Identity drafts and reusable signatures."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.mail.doctype.identity.identity import add_identity, bulk_delete
from suite.mail.http.shapes import AccountInput, Address, Identity


class CreateIdentity(AccountInput):
    email: str
    name: NotRequired[str | None]
    reply_to: NotRequired[list[Address] | None]
    bcc: NotRequired[list[Address] | None]
    text_signature: NotRequired[str | None]
    html_signature: NotRequired[str | None]


class SaveIdentity(AccountInput):
    id: str
    name: str | None
    reply_to: list[Address]
    bcc: list[Address]
    html_signature: str | None


class DeleteIdentities(TypedDict):
    names: list[str]


class Signature(TypedDict):
    name: str
    signature_name: str
    html_body: str | None


class SignatureFields(TypedDict):
    signature_name: str
    html_body: str | None


class SignatureName(TypedDict):
    name: str


class UpdateSignature(SignatureFields, SignatureName):
    pass


@frappe.whitelist(methods=["PATCH"])
def save_identity(
    account: str,
    id: str,
    name: str | None,
    reply_to: list[Address],
    bcc: list[Address],
    html_signature: str | None,
) -> None:
    doc = frappe.get_doc("Identity", f"{account}|{id}")
    doc.check_permission("write")
    doc.update({"_name": name, "reply_to": reply_to, "bcc": bcc, "html_signature": html_signature})
    doc.save()


@frappe.whitelist(methods=["GET"])
def signatures() -> list[Signature]:
    return frappe.get_list(
        "Mail Signature",
        fields=list(Signature.__annotations__),
        filters={"user": frappe.session.user},
        limit_page_length=0,
    )


@frappe.whitelist(methods=["POST"])
def create_signature(signature_name: str, html_body: str | None) -> str:
    return (
        frappe.get_doc(
            {
                "doctype": "Mail Signature",
                "user": frappe.session.user,
                "signature_name": signature_name,
                "html_body": html_body,
            }
        )
        .insert()
        .name
    )


@frappe.whitelist(methods=["PATCH"])
def update_signature(name: str, signature_name: str, html_body: str | None) -> None:
    doc = frappe.get_doc("Mail Signature", name)
    doc.check_permission("write")
    doc.update({"signature_name": signature_name, "html_body": html_body})
    doc.save()


@frappe.whitelist(methods=["DELETE"])
def delete_signature(name: str) -> None:
    frappe.delete_doc("Mail Signature", name)


ROUTES = (
    Route(
        "PATCH",
        "identities",
        "save_identity",
        kind="mutation",
        public_name="identities.save",
        body=SaveIdentity,
        output=type(None),
    ),
    Route(
        "GET", "signatures", "signatures", kind="query", public_name="signatures.list", output=list[Signature]
    ),
    Route(
        "POST",
        "signatures",
        "create_signature",
        kind="mutation",
        public_name="signatures.create",
        body=SignatureFields,
        output=str,
    ),
    Route(
        "PATCH",
        "signatures",
        "update_signature",
        kind="mutation",
        public_name="signatures.update",
        body=UpdateSignature,
        output=type(None),
    ),
    Route(
        "DELETE",
        "signatures",
        "delete_signature",
        kind="mutation",
        public_name="signatures.delete",
        query=SignatureName,
        output=type(None),
    ),
)
CONTRACT_ROUTES = (
    Route(
        "POST",
        "/api/method/suite.mail.doctype.identity.identity.add_identity",
        "add_identity",
        id="add_identity",
        kind="mutation",
        public_name="identities.create",
        body=CreateIdentity,
        output=str,
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.doctype.identity.identity.bulk_delete",
        "delete_identity_names",
        id="delete_identity_names",
        kind="mutation",
        public_name="identities.delete",
        body=DeleteIdentities,
        output=type(None),
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
)
delete_identity_names = bulk_delete
