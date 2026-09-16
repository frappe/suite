"""Frappe HTTP registration for Calendar resources."""

from suite.calendar.http.routes import ROUTES
from suite.composition.http import HttpOwner

HTTP = HttpOwner(
    owner="calendar",
    prefix="/api/suite/calendar/",
    target="suite.calendar.http.routes",
    routes=ROUTES,
    strip_owner=False,
)
