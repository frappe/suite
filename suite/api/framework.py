"""Frappe HTTP registration for Suite resources."""

from suite.api.routes import CONTRACT_ROUTES, ROUTES
from suite.composition.http import HttpOwner

HTTP = HttpOwner(
    owner="suite",
    prefix="/api/suite/",
    target="suite.api.routes",
    routes=ROUTES,
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
