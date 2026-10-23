"""Suite composition registrations."""

SUITE_TABLE = "suite.api.framework.HTTP"

# Suite resources have no extra owner segment. Each name is its own first path
# segment and points at the Suite table. No product owner may register one of
# these names (spec §4.2).
SUITE_RESOURCES = (
    "account",
    "site",
    "users",
    "invitations",
    "people",
    "preferences",
    "languages",
    "storage",
    "admin",
    "onboarding",
)


def check_suite_resources(owners: dict[str, str]) -> None:
    """Refuse an owner table that gives a Suite resource name to anyone else."""

    taken = {name: owners.get(name) for name in SUITE_RESOURCES if owners.get(name) != SUITE_TABLE}
    if taken:
        raise ValueError(f"Suite resource names are reserved for {SUITE_TABLE}: {taken}")


# Product resources use their product segment.
HTTP_OWNERS = {
    **dict.fromkeys(SUITE_RESOURCES, SUITE_TABLE),
    "drive": "suite.drive.framework.HTTP",
    "mail": "suite.mail.http.framework.HTTP",
    "calendar": "suite.calendar.http.framework.HTTP",
    "writer": "suite.writer.http.framework.HTTP",
    "sheets": "suite.sheets.http.framework.HTTP",
    "slides": "suite.slides.http.framework.HTTP",
    "meet": "suite.meet.http.framework.HTTP",
}

check_suite_resources(HTTP_OWNERS)
