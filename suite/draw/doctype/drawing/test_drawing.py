"""Check that saved drawings can be opened by the scene parser."""

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from suite.draw.doctype.drawing.drawing import Drawing
from suite.draw.drive import version_bytes


def rectangle(**fields):
    shape = {
        "id": "rectangle",
        "x": 12,
        "y": 23,
        "width": 28,
        "height": 27,
        "rotation": 0,
        "cornerRadius": 0,
    }
    shape.update(fields)
    return shape


class TestDrawingSceneValidation(TestCase):
    def _document(self, scene):
        return SimpleNamespace(
            content=json.dumps(scene),
            _check_node_assignment=lambda: None,
        )

    def _validate(self, scene):
        Drawing.validate.__wrapped__(self._document(scene))

    def _assert_invalid(self, scene):
        with (
            patch(
                "suite.draw.doctype.drawing.drawing.frappe.throw",
                side_effect=ValueError,
            ),
            patch("suite.draw.doctype.drawing.drawing._", side_effect=lambda text: text),
            self.assertRaises(ValueError),
        ):
            self._validate(scene)

    def test_app_generated_scene_fields_are_accepted_without_rewriting(self):
        image = rectangle(
            id="image",
            kind="image",
            src="data:image/png;base64,AAAA",
            naturalWidth=800,
            naturalHeight=600,
            crop={"x": 10, "y": 20, "width": 400, "height": 300},
            groupId="group-1",
            order=2,
            stroke=None,
            strokeWidth=1,
            strokeStyle="dashed",
            opacity=0.7,
            link="https://example.com",
            label="Plan",
            labelFontSize=16,
            labelFontFamily="inter",
            labelFill="#111111",
            labelFontWeight=600,
            labelFontStyle="italic",
            labelTextDecoration="underline",
            labelTextAlign="center",
        )
        line = {
            "id": "line",
            "kind": "arrow",
            "start": {"x": 10, "y": 20},
            "end": {"x": 80, "y": 90},
            "curve": {"x": 40, "y": 30},
            "arrowHeadFill": "#111111",
        }
        scene = {"rectangles": [image], "lines": [line]}
        content = json.dumps(scene)
        document = self._document(scene)

        Drawing.validate.__wrapped__(document)

        self.assertEqual(document.content, content)

    def test_legacy_scene_without_optional_fields_remains_valid(self):
        legacy = rectangle(kind="text", text="Old note", fontSize=18, fontFamily="monday", wrap=True)
        self._validate({"rectangles": [legacy], "lines": []})

    def test_scene_style_and_metadata_rejected_by_editor_are_refused(self):
        invalid_shapes = (
            rectangle(labelFontFamily="comic-sans"),
            rectangle(order="top"),
            rectangle(groupId=42),
            rectangle(strokeWidth=0),
            rectangle(opacity=1.1),
            rectangle(link="x" * 2049),
            rectangle(link="\U0001f642" * 1025),
            rectangle(label=None),
            rectangle(kind="text", text="Note", fontSize=12, textAlign="diagonal"),
        )
        for shape in invalid_shapes:
            with self.subTest(shape=shape):
                self._assert_invalid({"rectangles": [shape], "lines": []})

    def test_null_line_curve_is_refused(self):
        line = {
            "id": "line",
            "kind": "line",
            "start": {"x": 0, "y": 0},
            "end": {"x": 10, "y": 10},
            "curve": None,
        }
        self._assert_invalid({"rectangles": [], "lines": [line]})

    def test_invalid_image_crop_and_dimensions_are_refused(self):
        base = rectangle(kind="image", src="data:image/png;base64,AAAA", naturalWidth=100, naturalHeight=80)
        for changes in (
            {"crop": {"x": 90, "y": 0, "width": 20, "height": 20}},
            {"crop": {"x": 0, "y": 0, "width": -1, "height": 20}},
            {"naturalWidth": 0, "crop": {"x": 0, "y": 0, "width": 10, "height": 10}},
            {"naturalHeight": None},
            {"crop": {}},
            {"crop": []},
        ):
            with self.subTest(changes=changes):
                self._assert_invalid({"rectangles": [{**base, **changes}], "lines": []})

    def test_invalid_text_weight_is_refused(self):
        shape = rectangle(kind="text", text="Note", fontSize=12, fontWeight=800)
        self._assert_invalid({"rectangles": [shape], "lines": []})

    def test_missing_or_valid_pressure_samples_remain_valid(self):
        stroke = rectangle(kind="freedraw", points=[{"x": 0, "y": 0}, {"x": 1, "y": 1}])
        self._validate({"rectangles": [stroke], "lines": []})
        self._validate({"rectangles": [{**stroke, "pressures": [0, 1]}], "lines": []})

    def test_invalid_pressure_samples_are_refused(self):
        stroke = rectangle(kind="freedraw", points=[{"x": 0, "y": 0}, {"x": 1, "y": 1}])
        for pressures in (None, [0.5], [0.5, 1.1], [0.5, True]):
            with self.subTest(pressures=pressures):
                self._assert_invalid({"rectangles": [{**stroke, "pressures": pressures}], "lines": []})

    def test_freehand_point_limit_applies_to_the_whole_scene(self):
        points = [{"x": 0, "y": 0}] * 50001
        strokes = [
            rectangle(id=stroke_id, kind="freedraw", points=points) for stroke_id in ("first", "second")
        ]
        self._assert_invalid({"rectangles": strokes, "lines": []})

    def test_version_capture_preserves_old_scene_for_recovery(self):
        legacy_content = '{"rectangles":[{"id":"old","kind":"text","text":42}],"lines":[]}'
        document = SimpleNamespace(content=legacy_content, validate=lambda: self.fail("must not revalidate"))

        with patch("suite.draw.drive.frappe.get_doc", return_value=document):
            stream, mime = version_bytes("drawing")

        self.assertEqual(mime, "application/json")
        self.assertEqual(
            json.loads(stream.getvalue()),
            {"schema": "drawing/1", "content": json.loads(legacy_content)},
        )
