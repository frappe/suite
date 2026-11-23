# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""The whitelisted Sheets API offers no way to write a body but the live room.

Every edit reaches a sheet through the content layer's room
(`suite.sheets.content`), which checks access on each push. The old endpoints
that saved `sheets_data`, wrote the op log, or relayed edits and presence over
realtime are gone, so nothing can write a sheet around that check.
"""

from __future__ import annotations

import unittest

from suite.composition.http import Route
from suite.sheets import api
from suite.sheets.http.routes import CONTRACT_ROUTES

OLD_SAVE_PATH = (
    "save_sheet",
    "record_op",
    "broadcast_op",
    "broadcast_cursor",
    "ping_presence",
    "yjs_relay",
)


class OldSavePathIsGone(unittest.TestCase):
    def test_the_api_has_no_old_save_path_endpoint(self):
        for name in OLD_SAVE_PATH:
            with self.subTest(name=name):
                self.assertFalse(hasattr(api, name))

    def test_no_route_writes_a_body_or_reads_the_op_log(self):
        routes: tuple[Route, ...] = CONTRACT_ROUTES
        paths = {route.path for route in routes}
        self.assertNotIn("/api/method/suite.sheets.api.save_sheet", paths)
        self.assertFalse([path for path in paths if "versioning" in path])

    def test_the_old_body_still_opens_read_only_and_a_new_sheet_can_be_made(self):
        self.assertTrue(callable(api.get_sheet))
        self.assertTrue(callable(api.create_sheet))


if __name__ == "__main__":
    unittest.main()
