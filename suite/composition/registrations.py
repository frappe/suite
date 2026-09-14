"""Suite composition registrations."""

# Suite resources have no extra owner segment. Their first path segment points
# at the same Suite-owned table. Product resources use their product segment.
HTTP_OWNERS = {
    "account": "suite.api.framework.HTTP",
    "site": "suite.api.framework.HTTP",
    "users": "suite.api.framework.HTTP",
    "invitations": "suite.api.framework.HTTP",
    "drive": "suite.drive.framework.HTTP",
    "mail": "suite.mail.http.framework.HTTP",
    "calendar": "suite.calendar.http.framework.HTTP",
    "meet": "suite.meet.http.framework.HTTP",
}
