"""Make `presentation_states.json` once, by running Slides' converter on the demo's slide rows.

Rerun after changing a story in `assets` or `slide_rows`:
`bench --site <site> execute suite.composition.demo.make_presentation_states.write`
"""

import base64
import json
from unittest.mock import patch

import frappe

from suite.composition.demo import assets
from suite.content import convert
from suite.slides.content import CONVERTER_BUILD, CONVERTER_VERSION
from suite.slides.content.conversion import SLIDE_COLUMNS, legacy_deck


def write() -> None:
    """Convert each demo presentation's rows and write their states, refusing any the converter changes."""
    states: dict[str, str] = {}
    for title, story in assets.PRESENTATIONS.items():
        rows: list[frappe._dict] = []
        for row in assets.slide_rows(story):
            rows.append(frappe._dict({"client_id": None, **dict.fromkeys(SLIDE_COLUMNS), **row}))

        legacy = {**legacy_deck(title, rows), "collab": 0}
        with patch.object(
            frappe.local, "job", frappe._dict(job_name="make_presentation_states"), create=True
        ):
            converted = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)

        if not isinstance(converted, convert.Converted):
            raise RuntimeError(f"The converter refused {title!r}: {converted}")

        if converted.dropped:
            raise RuntimeError(f"The converter dropped parts of {title!r}: {converted.dropped}")

        states[title] = base64.b64encode(converted.state).decode()
        print(title, len(converted.state), "bytes")

    assets.PRESENTATION_STATES.write_text(json.dumps(states, indent=2) + "\n", encoding="utf-8")
