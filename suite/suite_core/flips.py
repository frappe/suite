"""The rollout flip keys (unified frontend spec §14.2).

Each flip is one site config key, `suite_flip_shell` or `suite_flip_files`.
The SPA boot, the composition redirect table, and Drive's `node_url` all read
a key through `flip_is_on`, so every reader agrees on one value.
"""

import frappe


def flip_is_on(key: str) -> bool:
    """Whether the flip site config `key` is on.

    On for 1, "1", True and "true" in any case. Off for anything else,
    including a missing key: `bench set-config` without `-p` stores "0" and
    "false" as strings, and those must read as off.
    """
    value = frappe.conf.get(key)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true")
    return value is True or (type(value) is int and value == 1)
