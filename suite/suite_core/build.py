"""Tell open tabs which frontend build the server runs.

The frontend build stamps its build time into `suite.html`. Every response
carries it as `X-Suite-Build`, so a tab on an older bundle can offer a
reload. Suite Settings' `min_builds` names, per product, the oldest build that
may still edit it, and travels as `X-Suite-Min-Builds`.
"""

import json
import os
import re

import frappe

PACKAGE_DIR = os.path.dirname(os.path.dirname(__file__))
PAGE_PATH = os.path.join(PACKAGE_DIR, "www", "suite.html")
BUILD_STAMP = re.compile(r'<meta name="suite-build" content="(\d+)"')

page_cache = {"mtime": None, "build": None}


def current_build() -> str | None:
    try:
        mtime = os.stat(PAGE_PATH).st_mtime
    except OSError:
        return None

    if page_cache["mtime"] != mtime:
        with open(PAGE_PATH) as page:
            html = page.read()
        build_match = BUILD_STAMP.search(html)
        build = build_match and build_match.group(1)
        page_cache.update(mtime=mtime, build=build)
    return page_cache["build"]


def after_request(response):
    build = current_build()
    if build:
        response.headers["X-Suite-Build"] = build
    settings = frappe.get_cached_doc("Suite Settings")
    min_builds = settings.get("min_builds")
    if min_builds:
        parsed = frappe.parse_json(min_builds)
        response.headers["X-Suite-Min-Builds"] = json.dumps(parsed)
