"""Contracts for existing Sheets endpoints."""

from suite.composition.http import HttpOwner
from suite.sheets.http.routes import CONTRACT_ROUTES

HTTP = HttpOwner(
    owner="sheets",
    prefix="/api/suite/sheets/",
    target="suite.sheets.http.routes",
    routes=(),
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
