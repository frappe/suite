"""Frappe HTTP registration for Meet resources."""

from suite.composition.http import HttpOwner
from suite.meet.http.routes import CONTRACT_ROUTES, ROUTES

HTTP = HttpOwner(
    owner="meet",
    prefix="/api/suite/meet/",
    target="suite.meet.http.routes",
    routes=ROUTES,
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
