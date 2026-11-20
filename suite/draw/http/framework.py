"""Register Draw with Suite's resource dispatcher."""

from suite.composition.http import HttpOwner
from suite.draw.http.routes import ROUTES

HTTP = HttpOwner(
    owner="draw",
    prefix="/api/suite/draw/",
    target="suite.draw.http.routes",
    routes=ROUTES,
    strip_owner=False,
)
