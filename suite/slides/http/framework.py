"""Slides' routes, and contracts for existing Slides endpoints."""

from suite.composition.http import HttpOwner
from suite.slides.http.routes import CONTRACT_ROUTES, ROUTES

HTTP = HttpOwner(
    owner="slides",
    prefix="/api/suite/slides/",
    target="suite.slides.http.routes",
    routes=ROUTES,
    contract_routes=CONTRACT_ROUTES,
    strip_owner=False,
)
