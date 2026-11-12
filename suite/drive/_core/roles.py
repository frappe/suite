"""Drive's ordered role ladder."""

NONE = 0
READ = 10
COMMENT = 20
UPLOAD = 30
EDIT = 40
MANAGE = 50

ROLES = (NONE, READ, COMMENT, UPLOAD, EDIT, MANAGE)

PTYPE_ROLE = {
    "read": READ,
    "select": READ,
    "create": UPLOAD,
    "write": EDIT,
    "delete": MANAGE,
    "share": MANAGE,
}
DEFAULT_PTYPE_ROLE = EDIT
