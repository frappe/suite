import os
import shutil
from urllib.parse import unquote

import frappe
from frappe.utils import get_bench_path

from suite.store.base_store import Namespace, resolve_namespace_path


def get_data_base_path() -> str:
    """Base directory holding every LMDB data-store environment for the current site.

    Sits alongside the site's private files, so it is per-site (multi-tenant safe) and never web-served.
    """

    return os.path.join(get_bench_path(), "sites", frappe.local.site, "private", "files", "data-store")


def get_blob_base_path() -> str:
    """Base directory holding every blob store for the current site.

    Sits under the site's ``private`` directory (not ``private/files``), so it is per-site
    (multi-tenant safe), never web-served, and excluded from site backups — blobs are a cache
    refetched on demand, and backing them up would bloat every files backup.
    """

    return os.path.join(get_bench_path(), "sites", frappe.local.site, "private", "blob-store")


def get_search_base_path() -> str:
    """Base directory holding every Tantivy search index for the current site.

    Sits alongside the site's private files, so it is per-site (multi-tenant safe) and never web-served.
    """

    return os.path.join(get_bench_path(), "sites", frappe.local.site, "private", "files", "search-index")


def list_namespaces(base_path: str) -> list[tuple[str, ...]]:
    """Return every namespace (a tuple of decoded segments) that has a store under `base_path`.

    A namespace is a leaf directory — one with no sub-directories. The base path itself and any
    stray files sitting in it (e.g. blob-store temp files) are ignored.
    """

    if not os.path.isdir(base_path):
        return []

    namespaces = []
    for dirpath, dirnames, _filenames in os.walk(base_path):
        if dirpath == base_path or dirnames:
            continue

        relative = os.path.relpath(dirpath, base_path)
        namespaces.append(tuple(unquote(segment) for segment in relative.split(os.sep)))

    return namespaces


def destroy_namespace(base_path: str, namespace: Namespace) -> None:
    """Delete the on-disk directory for `namespace` under `base_path`, if it exists.

    The namespace may be a prefix of the namespaces stores use (e.g. ``"mail"`` removes
    ``<base>/mail`` and every ``mail/<account>`` store beneath it).
    """

    path = resolve_namespace_path(base_path, namespace)
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
