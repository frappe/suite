import frappe

THEME_MAP = {
    "System Default": "Automatic",
    "Light Mode": "Light",
    "Dark Mode": "Dark",
}


def execute():
    if not frappe.db.has_column("User Settings", "color_scheme"):
        return

    for user, color_scheme in frappe.get_all(
        "User Settings",
        fields=["user", "color_scheme"],
        filters={"color_scheme": ["in", list(THEME_MAP)]},
        as_list=True,
    ):
        frappe.db.set_value("User", user, "desk_theme", THEME_MAP[color_scheme], update_modified=False)
