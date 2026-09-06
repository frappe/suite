from pathlib import Path

import frappe

from suite.drive.api.files import get_file_internal
from suite.drive.api.permissions import user_has_permission
from suite.drive.http import shims
from suite.drive.utils import WRITER_CONTENT_DOCTYPE, get_root_folder


@frappe.whitelist(allow_guest=True)
def get_file_content(embed_name: str, parent_entity_name: str):
    """Serve one embed inside a document.

    §11.7 forwarder over `GET /nodes/<id>/media`. It answers a redirect to the
    signed URL §6.8 mints, not the bytes.
    """
    return shims.embed_file_content(embed_name, parent_entity_name)
