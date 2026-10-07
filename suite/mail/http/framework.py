"""Frappe HTTP registration for Mail resources."""

from suite.composition.http import HttpOwner
from suite.mail.http.routes import CONTRACT_ROUTES, ROUTES

HTTP = HttpOwner(
    owner="mail",
    prefix="/api/suite/mail/",
    target="suite.mail.http.routes",
    routes=ROUTES,
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
