"""Contracts for existing Writer endpoints."""

from suite.composition.http import HttpOwner
from suite.writer.http.routes import CONTRACT_ROUTES

HTTP = HttpOwner(
    owner="writer",
    prefix="/api/suite/writer/",
    target="suite.writer.http.routes",
    routes=(),
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
