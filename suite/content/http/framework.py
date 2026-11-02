"""Frappe HTTP registration for the content layer's routes."""

from suite.composition.http import HttpOwner
from suite.content.http.routes import ROUTES

HTTP = HttpOwner(
    owner="content",
    prefix="/api/suite/content/",
    target="suite.content.http.routes",
    routes=ROUTES,
    strip_owner=False,
)
