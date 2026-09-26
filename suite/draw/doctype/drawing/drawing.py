import json
import re

import frappe
from frappe.model.document import Document

MAX_SHAPES = 10_000
MAX_POINTS = 100_000
MAX_COORDINATE = 100_000_000
SHAPE_KINDS = {"diamond", "ellipse", "text", "image", "freedraw"}


def _valid_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and abs(value) < MAX_COORDINATE
    )


def _valid_point(value):
    return (
        isinstance(value, dict)
        and _valid_number(value.get("x"))
        and _valid_number(value.get("y"))
    )


class Drawing(Document):
    def validate(self):
        try:
            scene = json.loads(self.content) if isinstance(self.content, str) else self.content
        except (json.JSONDecodeError, TypeError):
            frappe.throw("Drawing content must be valid JSON.")

        if not isinstance(scene, dict):
            frappe.throw("Drawing content must contain a scene.")

        rectangles = scene.get("rectangles")
        lines = scene.get("lines")
        if not isinstance(rectangles, list) or not isinstance(lines, list):
            frappe.throw("A drawing must contain rectangle and line lists.")
        if len(rectangles) + len(lines) > MAX_SHAPES:
            frappe.throw(f"A drawing cannot contain more than {MAX_SHAPES:,} objects.")

        ids = set()
        geometry = ("x", "y", "width", "height", "rotation", "cornerRadius")
        for objects, is_line in ((rectangles, False), (lines, True)):
            for shape in objects:
                if (
                    not isinstance(shape, dict)
                    or not isinstance(shape.get("id"), str)
                    or shape["id"] in ids
                ):
                    frappe.throw("Every drawing object must have a unique ID.")
                ids.add(shape["id"])

                kind = shape.get("kind")
                if is_line:
                    curve = shape.get("curve")
                    valid_curve = curve is None or _valid_number(curve) or _valid_point(curve)
                    if (
                        not isinstance(kind, str)
                        or kind not in {"line", "arrow"}
                        or not _valid_point(shape.get("start"))
                        or not _valid_point(shape.get("end"))
                        or not valid_curve
                    ):
                        frappe.throw("A drawing line has invalid geometry.")
                    continue

                if kind is not None and (not isinstance(kind, str) or kind not in SHAPE_KINDS):
                    frappe.throw("A drawing object has an invalid type.")
                if (
                    not all(_valid_number(shape.get(field)) for field in geometry)
                    or shape["width"] < 0
                    or shape["height"] < 0
                ):
                    frappe.throw("A drawing object has invalid geometry.")

                if kind == "freedraw":
                    points = shape.get("points")
                    if (
                        not isinstance(points, list)
                        or len(points) > MAX_POINTS
                        or not all(_valid_point(point) for point in points)
                    ):
                        frappe.throw("A free draw object has invalid points.")
                elif kind == "text":
                    if (
                        not isinstance(shape.get("text"), str)
                        or not _valid_number(shape.get("fontSize"))
                        or shape["fontSize"] <= 0
                    ):
                        frappe.throw("A text object has invalid content.")
                elif kind == "image":
                    source = shape.get("src")
                    if not isinstance(source, str) or not re.match(
                        r"^data:image/(png|jpe?g|gif|webp);base64,", source, re.I
                    ):
                        frappe.throw("An image object has an invalid source.")
