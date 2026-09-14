"""Frappe HTTP registration for Mail resources."""

from suite.composition.http import HttpOwner
from suite.mail.http.routes import ROUTES

HTTP = HttpOwner(
    owner="mail",
    prefix="/api/suite/mail/",
    target="suite.mail.http.routes",
    routes=ROUTES,
    strip_owner=False,
)
