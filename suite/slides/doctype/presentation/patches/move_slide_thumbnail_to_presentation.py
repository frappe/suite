import frappe


def is_thumbnail_path(thumbnail):
    return thumbnail and isinstance(thumbnail, str) and not thumbnail.startswith("data:")


def execute():
    # Presentation's field left the DocType (Q19'), so its column, where one is left, is reached by SQL
    if not frappe.db.has_column("Slide", "thumbnail") or not frappe.db.has_column(
        "Presentation", "thumbnail"
    ):
        return

    presentations = frappe.db.sql("SELECT `name`, `thumbnail` FROM `tabPresentation`", as_dict=True)

    for presentation in presentations:
        if presentation.thumbnail:
            continue

        first_slide_thumbnail = frappe.db.get_value(
            "Slide",
            {"parent": presentation.name, "idx": 1},
            "thumbnail",
        )
        if is_thumbnail_path(first_slide_thumbnail):
            frappe.db.sql(
                "UPDATE `tabPresentation` SET `thumbnail` = %s WHERE `name` = %s",
                (first_slide_thumbnail, presentation.name),
            )
