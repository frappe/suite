"""Frappe HTTP registration for Meet resources."""

from suite.composition.http import HttpOwner
from suite.meet.http.routes import ROUTES

HTTP = HttpOwner(
    owner="meet",
    prefix="/api/suite/meet/",
    target="suite.meet.http.routes",
    routes=ROUTES,
    strip_owner=False,
)
