"""Validate freehand pressure samples at the drawing save boundary."""

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from suite.draw.doctype.drawing.drawing import Drawing


class TestDrawingPressureValidation(TestCase):
    def _document(self, pressures="missing"):
        stroke = {
            "id": "stroke",
            "kind": "freedraw",
            "x": 12,
            "y": 23,
            "width": 28,
            "height": 27,
            "rotation": 0,
            "cornerRadius": 0,
            "points": [{"x": 12, "y": 23}, {"x": 40, "y": 50}],
        }
        if pressures != "missing":
            stroke["pressures"] = pressures
        return SimpleNamespace(
            content=json.dumps({"rectangles": [stroke], "lines": []}),
            _check_node_assignment=lambda: None,
        )

    def _validate(self, document):
        Drawing.validate.__wrapped__(document)

    def test_missing_pressure_samples_remain_valid(self):
        self._validate(self._document())

    def test_valid_pressure_samples_remain_valid(self):
        self._validate(self._document([0, 1]))

    def test_malformed_pressure_samples_are_refused(self):
        for pressures in (None, [0.5], [0.5, 1.1], [0.5, True]):
            with self.subTest(pressures=pressures):
                with (
                    patch(
                        "suite.draw.doctype.drawing.drawing.frappe.throw",
                        side_effect=ValueError,
                    ),
                    patch("suite.draw.doctype.drawing.drawing._", side_effect=lambda text: text),
                    self.assertRaises(ValueError),
                ):
                    self._validate(self._document(pressures))
