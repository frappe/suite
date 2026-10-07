"""The Writer table: collaborative document routes, plus contracts for existing Writer endpoints."""

from suite.composition.http import HttpOwner
from suite.writer.collab.routes import ROUTES
from suite.writer.http.routes import CONTRACT_ROUTES

HTTP = HttpOwner(
    owner="writer",
    prefix="/api/suite/writer/",
    target="suite.writer.collab.routes",
    routes=ROUTES,
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
