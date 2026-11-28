"""Validate scenes at the drawing save boundary."""

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from suite.draw.doctype.drawing.drawing import Drawing

BOX = {"id": "box", "x": 12, "y": 23, "width": 28, "height": 27, "rotation": 0, "cornerRadius": 0}
STROKE = {**BOX, "kind": "freedraw", "points": [{"x": 12, "y": 23}, {"x": 40, "y": 50}]}
IMAGE = {
    **BOX,
    "kind": "image",
    "src": "data:image/png;base64,AAAA",
    "naturalWidth": 100,
    "naturalHeight": 80,
}


class TestDrawingSceneValidation(TestCase):
    def _validate(self, *rectangles, lines=()):
        content = json.dumps({"rectangles": rectangles, "lines": lines})
        document = SimpleNamespace(content=content, _check_node_assignment=lambda: None)
        Drawing.validate.__wrapped__(document)
        self.assertEqual(document.content, content)

    def _assert_invalid(self, *rectangles, lines=()):
        with (
            patch("suite.draw.doctype.drawing.drawing.frappe.throw", side_effect=ValueError),
            patch("suite.draw.doctype.drawing.drawing._", side_effect=lambda text: text),
            self.assertRaises(ValueError),
        ):
            self._validate(*rectangles, lines=lines)

    def test_accepts_legacy_missing_or_valid_pressure_samples(self):
        self._validate(STROKE)
        self._validate({**STROKE, "pressures": [0, 1]})

    def test_malformed_pressure_samples_are_refused(self):
        for pressures in (None, [0.5], [0.5, 1.1], [0.5, True]):
            with self.subTest(pressures=pressures):
                self._assert_invalid({**STROKE, "pressures": pressures})

    def test_accepts_legacy_text_and_current_image_labels_and_crop(self):
        self._validate(
            {**BOX, "kind": "text", "text": "Old note", "fontSize": 18, "fontFamily": "monday"},
            {
                **IMAGE,
                "id": "image",
                "crop": {"x": 10, "y": 20, "width": 40, "height": 30},
                "label": "Plan",
                "labelFontFamily": "inter",
                "labelFontWeight": 600,
                "labelTextAlign": "center",
                "stroke": None,
            },
        )

    def test_refuses_invalid_style_and_metadata(self):
        for fields in (
            {"labelFontFamily": "monday"},
            {"order": "top"},
            {"groupId": 42},
            {"strokeWidth": 0},
            {"opacity": 1.1},
            {"link": "\U0001f642" * 1025},
            {"label": None},
            {"kind": "text", "text": "Note", "fontSize": 12, "textAlign": "diagonal"},
            {"kind": "text", "text": "Note", "fontSize": 12, "fontWeight": 800},
        ):
            with self.subTest(fields=fields):
                self._assert_invalid({**BOX, **fields})

    def test_requires_curve_geometry_if_present(self):
        line = {"id": "arrow", "kind": "arrow", "start": {"x": 0, "y": 0}, "end": {"x": 10, "y": 10}}
        self._validate(lines=[{**line, "curve": {"x": 5, "y": 2}, "arrowHeadFill": "#111111"}])
        self._assert_invalid(lines=[{**line, "curve": None}])

    def test_refuses_invalid_image_crop_and_dimensions(self):
        for fields in (
            {"crop": {"x": 90, "y": 0, "width": 20, "height": 20}},
            {"crop": {"x": 0, "y": 0, "width": -1, "height": 20}},
            {"naturalWidth": 0},
            {"naturalHeight": None},
            {"crop": {}},
            {"crop": []},
        ):
            with self.subTest(fields=fields):
                self._assert_invalid({**IMAGE, **fields})

    def test_freehand_point_limit_applies_to_the_whole_scene(self):
        stroke = {**STROKE, "points": [{"x": 0, "y": 0}] * 50_001}
        self._assert_invalid(stroke, {**stroke, "id": "second"})
