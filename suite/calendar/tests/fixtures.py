# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What the calendar tests hand a store or a sync, stated once."""

# A day off, as a source states one to the external store.
HOLIDAY = {
    "uid": "holiday-India 2026-2026-10-02",
    "title": "Gandhi Jayanti",
    "starts_on": "2026-10-02 00:00:00",
    "ends_on": "2026-10-03 00:00:00",
    "all_day": True,
}

# A birthday, which a source states once and the calendar draws in every year from its first.
BIRTHDAY = {
    "uid": "birthday-EMP-1",
    "title": "Akash Tom's birthday",
    "starts_on": "2026-07-09 00:00:00",
    "ends_on": "2026-07-10 00:00:00",
    "all_day": True,
    "repeats": "Yearly",
}
