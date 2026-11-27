"""Validate drawing scenes and defer identity and access to Drive."""

import json
import math
import re

import frappe
from frappe import _
from frappe.model.document import Document

from suite import drive
from suite.draw.drive import MAX_CONTENT_BYTES, _operation

MAX_SHAPES = 10_000
MAX_POINTS = 100_000
MAX_COORDINATE = 100_000_000
SHAPE_KINDS = {"diamond", "ellipse", "text", "image", "freedraw"}
LINE_KINDS = {"line", "arrow"}
FONT_FAMILIES = {"shantell", "inter", "georgia", "mono"}
FONT_WEIGHTS = (400, 500, 600, 700)
TEXT_ALIGNMENTS = ("left", "center", "right", "justify")


def _valid_number(value):
    return isinstance(value, int | float) and not isinstance(value, bool) and abs(value) < MAX_COORDINATE


def _valid_point(value):
    return isinstance(value, dict) and _valid_number(value.get("x")) and _valid_number(value.get("y"))


def _finite_number(value: object) -> bool:
    if not isinstance(value, int | float) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _valid_optional_fields(shape: dict, is_line: bool) -> bool:
    string_fields: tuple[str, ...] = ("stroke", "fill", "link", "label", "labelFill")
    if is_line:
        string_fields = (*string_fields, "arrowHeadFill")
    if any(
        field in shape
        and not isinstance(shape[field], str)
        and not (field == "stroke" and shape[field] is None)
        for field in string_fields
    ):
        return False
    # The editor counts link length in UTF-16 code units.
    if "link" in shape and len(shape["link"].encode("utf-16-le")) // 2 > 2048:
        return False
    if "strokeWidth" in shape and (not _finite_number(shape["strokeWidth"]) or shape["strokeWidth"] <= 0):
        return False
    if "strokeStyle" in shape and shape["strokeStyle"] not in ("solid", "dashed", "dotted"):
        return False
    if "opacity" in shape and (not _finite_number(shape["opacity"]) or not 0 <= shape["opacity"] <= 1):
        return False
    if "groupId" in shape and not isinstance(shape["groupId"], str):
        return False
    if "order" in shape and not _finite_number(shape["order"]):
        return False

    if "labelFontSize" in shape and (
        not _finite_number(shape["labelFontSize"]) or shape["labelFontSize"] <= 0
    ):
        return False
    if "labelFontFamily" in shape and (
        not isinstance(shape["labelFontFamily"], str) or shape["labelFontFamily"] not in FONT_FAMILIES
    ):
        return False
    if "labelFontWeight" in shape and shape["labelFontWeight"] not in FONT_WEIGHTS:
        return False
    if "labelFontStyle" in shape and shape["labelFontStyle"] not in ("normal", "italic"):
        return False
    if "labelTextDecoration" in shape and shape["labelTextDecoration"] not in (
        "none",
        "underline",
        "line-through",
    ):
        return False
    if "labelTextAlign" in shape and shape["labelTextAlign"] not in TEXT_ALIGNMENTS:
        return False
    return True


def _valid_pressures(value, point_count):
    return (
        isinstance(value, list)
        and len(value) == point_count
        and all(_valid_number(pressure) and 0 <= pressure <= 1 for pressure in value)
    )


class Drawing(drive.DriveContent, Document):
    def before_insert(self):
        self._check_node_assignment()

    def validate(self):
        self._check_node_assignment()
        try:
            if isinstance(self.content, str) and len(self.content.encode("utf-8")) > MAX_CONTENT_BYTES:
                frappe.throw(_("Drawing content cannot exceed 64 MB."))
            scene = json.loads(self.content) if isinstance(self.content, str) else self.content
            raw = json.dumps(scene, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
                "utf-8"
            )
        except ValueError, TypeError, UnicodeError:
            frappe.throw(_("Drawing content must be valid JSON."))
        if len(raw) > MAX_CONTENT_BYTES:
            frappe.throw(_("Drawing content cannot exceed 64 MB."))

        if not isinstance(scene, dict):
            frappe.throw(_("Drawing content must contain a scene."))

        rectangles = scene.get("rectangles")
        lines = scene.get("lines")
        if not isinstance(rectangles, list) or not isinstance(lines, list):
            frappe.throw(_("A drawing must contain rectangle and line lists."))
        if len(rectangles) + len(lines) > MAX_SHAPES:
            frappe.throw(_("A drawing cannot contain more than {0} objects.").format(f"{MAX_SHAPES:,}"))

        ids = set()
        total_points = 0
        geometry = ("x", "y", "width", "height", "rotation", "cornerRadius")
        for objects, is_line in ((rectangles, False), (lines, True)):
            for shape in objects:
                if not isinstance(shape, dict) or not isinstance(shape.get("id"), str) or shape["id"] in ids:
                    frappe.throw(_("Every drawing object must have a unique ID."))
                ids.add(shape["id"])
                if not _valid_optional_fields(shape, is_line):
                    frappe.throw(_("A drawing object has invalid style or metadata."))

                kind = shape.get("kind")
                if is_line:
                    curve = shape.get("curve")
                    valid_curve = "curve" not in shape or _valid_number(curve) or _valid_point(curve)
                    if (
                        not isinstance(kind, str)
                        or kind not in LINE_KINDS
                        or not _valid_point(shape.get("start"))
                        or not _valid_point(shape.get("end"))
                        or not valid_curve
                    ):
                        frappe.throw(_("A drawing line has invalid geometry."))
                    continue

                if "kind" in shape and (not isinstance(kind, str) or kind not in SHAPE_KINDS):
                    frappe.throw(_("A drawing object has an invalid type."))
                if (
                    not all(_valid_number(shape.get(field)) for field in geometry)
                    or shape["width"] < 0
                    or shape["height"] < 0
                ):
                    frappe.throw(_("A drawing object has invalid geometry."))

                if kind == "freedraw":
                    points = shape.get("points")
                    if isinstance(points, list):
                        total_points += len(points)
                    if (
                        not isinstance(points, list)
                        or total_points > MAX_POINTS
                        or not all(_valid_point(point) for point in points)
                    ):
                        frappe.throw(_("A free draw object has invalid points."))
                    if "pressures" in shape and not _valid_pressures(shape["pressures"], len(points)):
                        frappe.throw(_("A free draw object has invalid pressure data."))
                elif kind == "text":
                    font_family = shape.get("fontFamily")
                    if (
                        not isinstance(shape.get("text"), str)
                        or not _valid_number(shape.get("fontSize"))
                        or shape["fontSize"] <= 0
                        or (
                            "fontFamily" in shape
                            and (
                                not isinstance(font_family, str)
                                or (font_family != "monday" and font_family not in FONT_FAMILIES)
                            )
                        )
                        or ("backgroundColor" in shape and not isinstance(shape["backgroundColor"], str))
                        or ("fontWeight" in shape and shape["fontWeight"] not in FONT_WEIGHTS)
                        or ("fontStyle" in shape and shape["fontStyle"] not in ("normal", "italic"))
                        or (
                            "textDecoration" in shape
                            and shape["textDecoration"] not in ("none", "underline", "line-through")
                        )
                        or ("textAlign" in shape and shape["textAlign"] not in TEXT_ALIGNMENTS)
                    ):
                        frappe.throw(_("A text object has invalid content."))
                elif kind == "image":
                    source = shape.get("src")
                    if not isinstance(source, str) or not re.match(
                        r"^data:image/(png|jpe?g|gif|webp);base64,", source, re.I
                    ):
                        frappe.throw(_("An image object has an invalid source."))
                    has_width = "naturalWidth" in shape
                    has_height = "naturalHeight" in shape
                    if (has_width or has_height) and (
                        not _finite_number(shape.get("naturalWidth"))
                        or not _finite_number(shape.get("naturalHeight"))
                        or shape["naturalWidth"] <= 0
                        or shape["naturalHeight"] <= 0
                    ):
                        frappe.throw(_("An image object has invalid dimensions."))
                    crop = shape.get("crop")
                    if crop is not None:
                        if (
                            not isinstance(crop, dict)
                            or not has_width
                            or not has_height
                            or not all(
                                _finite_number(crop.get(field)) for field in ("x", "y", "width", "height")
                            )
                            or crop["x"] < 0
                            or crop["y"] < 0
                            or crop["width"] <= 0
                            or crop["height"] <= 0
                            or crop["x"] + crop["width"] > shape["naturalWidth"]
                            or crop["y"] + crop["height"] > shape["naturalHeight"]
                        ):
                            frappe.throw(_("An image object has an invalid crop."))

    def before_save(self):
        if self.get("node") and not self.is_new():
            if self.has_value_changed("content") and _operation.get() not in (
                ("save", self.name),
                ("restore", self.name),
            ):
                frappe.throw(_("Save drawing scenes through Draw."), frappe.PermissionError)
            self.drive_check(drive.EDIT)

    def on_update(self):
        if self.get("node") and not self.flags.in_insert and self.has_value_changed("content"):
            self.drive_touch()

    def on_trash(self):
        if self.get("node") and _operation.get() != ("purge", self.name):
            frappe.throw(_("Delete drawings through Drive."), frappe.PermissionError)

    def _check_node_assignment(self):
        node = self.get("node")
        if not node:
            return
        stored = None if self.is_new() else frappe.db.get_value(self.doctype, self.name, "node")
        if not stored and _operation.get() != ("create", node):
            frappe.throw(_("Create drawing nodes through Drive."), frappe.PermissionError)
