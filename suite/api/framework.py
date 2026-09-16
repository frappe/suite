"""Frappe HTTP registration for Suite resources."""

from suite.api.routes import ROUTES
from suite.composition.http import HttpOwner

HTTP = HttpOwner(
    owner="suite",
    prefix="/api/suite/",
    target="suite.api.routes",
    routes=ROUTES,
    strip_owner=False,
)
