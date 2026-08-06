from suite.drive.api.permissions import get_user_access_for_user
from suite.drive.utils import GENERAL_USER, generate_upward_path


def get_default_access(entity):
    # General access marker: -2 public (link), -1 site users, 0 restricted.
    default = 0
    if entity:
        name = entity if isinstance(entity, str) else entity.get("name")
        if get_user_access_for_user(entity, "Guest")["read"]:
            default = -2
        elif generate_upward_path(name, GENERAL_USER)[-1]["read"]:
            default = -1
    return default


def prettify_file(f: dict):
    f["share_count"] = get_default_access(f)
    return f
