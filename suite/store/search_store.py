import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from typing import ClassVar, Literal
from urllib.parse import quote

import frappe
import tantivy
from frappe import _
from frappe.deprecation_dumpster import deprecation_warning

from suite.store import get_search_base_path
from suite.store.base_store import Namespace, normalize_namespace, resolve_namespace_path
from suite.utils.lock import write_lock

SCHEMA_VERSION_FILE = "schema.version"

# How many documents an unbounded fetch (`limit=None`) asks for before it knows how many match.
# Sized so one pass almost always holds the whole match set; see `_run_search` for what a miss costs.
UNBOUNDED_FETCH_PAGE = 5000

# How many IDs one `merge_document` lookup asks about at a time, bounding the size of the boolean
# query it builds when a caller upserts a large batch.
UPSERT_LOOKUP_CHUNK = 1000


@dataclass(frozen=True)
class FieldSpec:
    """Describes one field of a search index's schema."""

    name: str
    kind: Literal["text", "integer", "date", "boolean"] = "text"
    stored: bool = False
    fast: bool = False
    tokenizer: str = "default"


class SearchStore:
    """A Tantivy full-text index for one entity type, scoped to a `namespace`.

    Subclasses declare their schema via ENTITY and FIELDS, and may override `to_document`
    to shape a raw source dict into the flat field/value dict this index stores. Each
    `namespace` (a relative path, e.g. ``("mail", account)``) gets its own on-disk directory
    under `get_search_base_path()`, so its indexes stay isolated from other namespaces.
    """

    # Entity name; forms part of the on-disk path and lock name. Required in subclasses.
    ENTITY: ClassVar[str] = ""
    # Field used as the unique document identifier for upserts and deletes.
    ID_FIELD: ClassVar[str] = "id"
    # Schema definition; changing it bumps the schema version and triggers a rebuild.
    FIELDS: ClassVar[tuple[FieldSpec, ...]] = ()
    # Fields queried when a search call doesn't specify its own field list.
    DEFAULT_SEARCH_FIELDS: ClassVar[tuple[str, ...]] = ()
    # Whether an upsert reads the document it replaces and hands it to `merge_document`.
    MERGE_ON_UPSERT: ClassVar[bool] = False

    # Per-writer memory budget for indexing, in bytes.
    HEAP_SIZE: ClassVar[int] = 50 * 1024 * 1024

    def __init__(self, namespace: Namespace) -> None:
        """Resolve this index's on-disk path from namespace/ENTITY and reconcile its schema version."""

        if not self.ENTITY:
            frappe.throw("SearchStore subclasses must define ENTITY")

        self.namespace = normalize_namespace(namespace)
        # Layout is <base>/<namespace>/<entity>, so every index for a namespace (e.g. an account)
        # lives under one directory — easy to browse and to clear all of a namespace's indexes at once.
        namespace_path = resolve_namespace_path(get_search_base_path(), self.namespace)
        self.path = os.path.join(namespace_path, self.ENTITY)
        os.makedirs(self.path, exist_ok=True)

        self._schema = self._build_schema()
        self._reconcile_schema_version()

    def index_documents(self, sources: list[dict]) -> int:
        """Upsert the given source dicts into the index; returns the number processed.

        Each source is deleted-then-added by its ID_FIELD, so re-indexing an existing
        document replaces it. Sources without an ID are skipped.

        A store with MERGE_ON_UPSERT set reads the documents being replaced first and runs each
        replacement through `merge_document`, so state already in the index can be carried into it.
        That read happens under the same write lock as the write: the lock is not reentrant, so a
        subclass could not take it itself, and reading outside it would let a concurrent upsert of
        the same document land in between and lose whatever the merge carried forward.
        """

        if not sources:
            return 0

        documents = [self.to_document(source) for source in sources]
        documents = [document for document in documents if document.get(self.ID_FIELD) is not None]

        with write_lock(self._lockname, acquire_timeout=30, lock_timeout=300):
            index = self._open()

            if self.MERGE_ON_UPSERT:
                # Pick up commits made by other workers since this index was opened, so the merge
                # builds on their documents rather than on a stale view of them.
                index.reload()
                indexed = self._existing_documents(index, [str(d[self.ID_FIELD]) for d in documents])

                # Collected by ID, so a batch carrying the same document twice accumulates into one
                # write: the second merges onto what the first produced instead of replacing it
                # unread, which would drop whatever the first had carried forward.
                merged = {}
                for document in documents:
                    doc_id = str(document[self.ID_FIELD])
                    replaced = merged.get(doc_id) or indexed.get(doc_id)
                    merged[doc_id] = self.merge_document(document, replaced)

                documents = list(merged.values())

            writer = index.writer(heap_size=self.HEAP_SIZE, num_threads=1)

            try:
                for document in documents:
                    # Delete any existing doc with this ID first so re-indexing is an upsert.
                    writer.delete_documents(self.ID_FIELD, str(document[self.ID_FIELD]))
                    writer.add_document(self._to_tantivy_document(document))

                writer.commit()
                writer.wait_merging_threads()
            finally:
                # Release the writer's lock even if commit raised.
                del writer

        return len(sources)

    def _existing_documents(self, index: tantivy.Index, ids: list[str]) -> dict[str, dict]:
        """Return the indexed documents for `ids`, keyed by ID_FIELD; absent IDs are simply missing.

        Only the documents an upsert is about to replace are looked up, in chunks of
        `UPSERT_LOOKUP_CHUNK` so one large batch doesn't build one enormous boolean query. Errors
        are left to propagate: a lookup that quietly came back empty would read as "nothing indexed
        yet" and let the merge discard what every one of these documents had accumulated.
        """

        searcher = index.searcher()
        if not ids or not searcher.num_docs:
            return {}

        found = {}
        for start in range(0, len(ids), UPSERT_LOOKUP_CHUNK):
            chunk = ids[start : start + UPSERT_LOOKUP_CHUNK]
            query = tantivy.Query.boolean_query(
                [
                    (tantivy.Occur.Should, tantivy.Query.term_query(self._schema, self.ID_FIELD, doc_id))
                    for doc_id in chunk
                ]
            )
            result = searcher.search(query, limit=len(chunk))
            for score, address in result.hits:
                hit = self._to_hit(searcher.doc(address), score)
                found[str(hit[self.ID_FIELD])] = hit

        return found

    def delete_documents(self, ids: list[str]) -> int:
        """Delete documents matching the given ID_FIELD values; returns the count requested."""

        if not ids:
            return 0

        with write_lock(self._lockname, acquire_timeout=30, lock_timeout=300):
            index = self._open()
            writer = index.writer(heap_size=self.HEAP_SIZE, num_threads=1)

            try:
                for doc_id in ids:
                    writer.delete_documents(self.ID_FIELD, str(doc_id))

                writer.commit()
                writer.wait_merging_threads()
            finally:
                # Release the writer's lock even if commit raised.
                del writer

        return len(ids)

    def search(
        self,
        query: str,
        limit: int = 20,
        offset: int = 0,
        fields: list[str] | None = None,
        order_by: str | None = None,
    ) -> tuple[list[dict], int]:
        """Run a free-text query (parsed by Tantivy) and return `(hits, total_count)`.

        `hits` is a page (`limit`/`offset`) of stored-field dicts, each annotated with
        `_score` and `_id`; `total_count` is the full number of matches. `fields` overrides
        DEFAULT_SEARCH_FIELDS. Returns an empty result on a blank query, a missing index, or
        any query error (logged, never raised, so search failures don't break the caller).
        """

        if not query or not query.strip():
            return ([], 0)

        fields = fields or list(self.DEFAULT_SEARCH_FIELDS) or None
        return self._run_search(lambda index: index.parse_query(query, fields), limit, offset, order_by)

    def search_prefix(
        self,
        terms: list[str],
        limit: int | None = 20,
        offset: int = 0,
        fields: list[str] | None = None,
        order_by: str | None = None,
    ) -> tuple[list[dict], int]:
        """Search for documents holding every term, with the last term matched as a prefix.

        Built for as-you-type autocomplete: every term must appear in one of `fields`, with the
        final one — the word still being typed — matched as a prefix. So "jane d" matches
        "jane.d@example.com" and "Jane Doe", and also "Jane Ann Doe", since the terms need not be
        adjacent or in order. Tantivy scores term and prefix queries alike as a constant, so these
        hits come back in index order: ranking them is the caller's job (see
        `EmailAddressIndex.search_email_addresses`). Returns `(hits, count)`.

        A caller that ranks the hits itself has to see all of them — an unscored page is an
        arbitrary slice, not the best matches — so `limit=None` returns every match.
        """

        terms = [term for term in terms if term]
        if not terms:
            return ([], 0)

        fields = fields or list(self.DEFAULT_SEARCH_FIELDS)
        return self._run_search(
            lambda _index: self._build_prefix_query(terms, fields), limit, offset, order_by
        )

    def search_phrase_prefix(
        self,
        terms: list[str],
        limit: int = 20,
        offset: int = 0,
        fields: list[str] | None = None,
        order_by: str | None = None,
    ) -> tuple[list[dict], int]:
        """Deprecated: the phrase-prefix search that `search_prefix` replaced.

        Kept with its semantics intact, so callers written against the old name keep getting what
        that name promised: the terms must appear adjacent and in order in one of `fields`, with the
        final one matched as a prefix — "jane d" matches "Jane Doe" but not "Jane Ann Doe".

        `search_prefix` is the one to move to. It is looser, matching every term wherever it falls,
        and it does not inherit what this carries: Tantivy expands the prefix to at most 50 terms,
        so on a sizeable index a short prefix silently drops every match past those 50.
        """

        deprecation_warning(
            marked="2026-08-10",
            graduation="v1",
            msg=(
                "SearchStore.search_phrase_prefix has been replaced by SearchStore.search_prefix, "
                "which matches every term wherever it falls rather than as one adjacent phrase."
            ),
        )

        terms = [term for term in terms if term]
        if not terms:
            return ([], 0)

        fields = fields or list(self.DEFAULT_SEARCH_FIELDS)
        return self._run_search(
            lambda _index: self._build_phrase_prefix_query(terms, fields), limit, offset, order_by
        )

    def _run_search(
        self, build_query, limit: int | None, offset: int, order_by: str | None
    ) -> tuple[list[dict], int]:
        """Open the index, build a query via `build_query(index)`, run it, and return `(hits, count)`.

        Shared plumbing for the `search*` methods; swallows query errors (logged) into an empty
        result so a malformed query never breaks the caller. `limit=None` returns every match.

        Everything runs against one searcher, which holds the segments as they stood when it was
        made. That is what makes an unbounded fetch whole rather than nearly whole: Tantivy needs a
        limit up front, so the fetch guesses a page and repeats with the count if it guessed short,
        and both passes have to read the same index for the count to still describe what the second
        pass fetches. Reopening between them would let a write land in between and leave the fetch
        short of its own count — the very truncation `limit=None` exists to avoid.
        """

        # Nothing has been indexed yet for this key.
        if not tantivy.Index.exists(self.path):
            return ([], 0)

        try:
            index = self._open()

            # Pick up commits made by other workers since this index was opened.
            index.reload()

            searcher = index.searcher()
            query = build_query(index)

            page = UNBOUNDED_FETCH_PAGE if limit is None else limit
            result = searcher.search(query, limit=page, offset=offset, count=True, order_by_field=order_by)

            # Guessed short: ask this same searcher again, now knowing how many there are.
            if limit is None and result.count - offset > page:
                result = searcher.search(
                    query, limit=result.count, offset=offset, count=True, order_by_field=order_by
                )

            hits = [self._to_hit(searcher.doc(address), score) for score, address in result.hits]
            return (hits, result.count)
        except Exception:
            frappe.logger("suite.store").warning(
                {"event": "search-failed", "entity": self.ENTITY, "namespace": "/".join(self.namespace)}
            )
            return ([], 0)

    def _build_prefix_query(self, terms: list[str], fields: list[str]) -> tantivy.Query:
        """Build an all-terms-with-trailing-prefix query, matching within any one of `fields`."""

        if len(fields) == 1:
            return self._build_field_prefix_query(terms, fields[0])

        # Match all the terms in any one of the fields.
        clauses = [(tantivy.Occur.Should, self._build_field_prefix_query(terms, field)) for field in fields]
        return tantivy.Query.boolean_query(clauses)

    def _build_phrase_prefix_query(self, terms: list[str], fields: list[str]) -> tantivy.Query:
        """Build a phrase-prefix query over `terms`, matching in any one of `fields`.

        Only the deprecated `search_phrase_prefix` builds these; `search_prefix` deliberately does
        not require the terms to be adjacent, and needs a prefix that expands without a cap.
        """

        if len(fields) == 1:
            return tantivy.Query.phrase_prefix_query(self._schema, fields[0], terms)

        # Match the phrase in any of the fields.
        clauses = [
            (tantivy.Occur.Should, tantivy.Query.phrase_prefix_query(self._schema, field, terms))
            for field in fields
        ]
        return tantivy.Query.boolean_query(clauses)

    def _build_field_prefix_query(self, terms: list[str], field: str) -> tantivy.Query:
        """Require every term in `field`, matching the last one as a prefix.

        The trailing term uses a zero-distance fuzzy *prefix* query rather than Tantivy's
        phrase-prefix query: the latter expands a prefix to at most 50 terms, so on a sizeable
        index a short prefix silently drops every match past those 50 — typing "j" would never
        reach "jane@example.com" — while the automaton behind this one matches them all.
        """

        clauses = [
            (tantivy.Occur.Must, tantivy.Query.term_query(self._schema, field, term)) for term in terms[:-1]
        ]
        clauses.append(
            (
                tantivy.Occur.Must,
                tantivy.Query.fuzzy_term_query(self._schema, field, terms[-1], distance=0, prefix=True),
            )
        )
        return tantivy.Query.boolean_query(clauses)

    def drop(self) -> None:
        """Delete this index's entire on-disk directory."""

        with write_lock(self._lockname, acquire_timeout=30, lock_timeout=300):
            if os.path.exists(self.path):
                shutil.rmtree(self.path)

    def to_document(self, source: dict) -> dict:
        """Map a raw source dict to a flat field/value dict. Override to reshape sources."""

        return source

    def merge_document(self, document: dict, existing: dict | None) -> dict:
        """Reconcile a document with the one it replaces, or None if the index doesn't hold one.

        Called for every upsert when MERGE_ON_UPSERT is set; override to carry state across
        re-indexing. `existing` holds the stored fields of the indexed document, so only stored
        fields survive into a merge.
        """

        return document

    @property
    def _lockname(self) -> str:
        """Lock name scoping writes to this entity/namespace, so concurrent workers serialize."""

        namespace = "/".join(quote(segment, safe="") for segment in self.namespace)
        return f"search-index:{self.ENTITY}:{namespace}"

    @property
    def _stored_fields(self) -> list[str]:
        """Names of fields marked `stored`, i.e. the ones returned in search hits."""

        return [field.name for field in self.FIELDS if field.stored]

    @staticmethod
    def _read_version(version_file: str) -> str | None:
        """Read the schema version written on disk, or None if it hasn't been written yet."""

        try:
            with open(version_file) as f:
                return f.read().strip()
        except FileNotFoundError:
            return None

    @staticmethod
    def _write_version(version_file: str, version: str) -> None:
        """Persist the current schema version alongside the index."""

        with open(version_file, "w") as f:
            f.write(version)

    def _build_schema(self) -> tantivy.Schema:
        """Build the Tantivy schema from FIELDS, mapping each FieldSpec kind to a field type."""

        builder = tantivy.SchemaBuilder()

        for field in self.FIELDS:
            if field.kind == "text":
                builder.add_text_field(
                    field.name, stored=field.stored, fast=field.fast, tokenizer_name=field.tokenizer
                )

            elif field.kind == "integer":
                builder.add_integer_field(field.name, stored=field.stored, indexed=True, fast=field.fast)

            elif field.kind == "date":
                builder.add_date_field(field.name, stored=field.stored, indexed=True, fast=field.fast)

            elif field.kind == "boolean":
                builder.add_boolean_field(field.name, stored=field.stored, indexed=True, fast=field.fast)

            else:
                frappe.throw(_("Unknown field kind: {0}").format(field.kind))

        return builder.build()

    def _reconcile_schema_version(self) -> None:
        """Rebuild the index from scratch if its stored schema version no longer matches.

        A first-time index just records the current version. A version mismatch means FIELDS
        changed, so the stale index directory is wiped and recreated (re-indexing happens
        lazily on the next write).
        """

        version_file = os.path.join(self.path, SCHEMA_VERSION_FILE)
        current = self._schema_version()
        existing = self._read_version(version_file)

        if existing == current:
            return

        if existing is None:
            self._write_version(version_file, current)
            return

        with write_lock(self._lockname, acquire_timeout=30, lock_timeout=300):
            # Re-check inside the lock: another worker may have rebuilt it already.
            if self._read_version(version_file) == current:
                return

            shutil.rmtree(self.path, ignore_errors=True)
            os.makedirs(self.path, exist_ok=True)
            self._write_version(version_file, current)

    def _open(self) -> tantivy.Index:
        """Open (or reuse) the on-disk index for this key."""

        return tantivy.Index(self._schema, path=self.path, reuse=True)

    def _to_tantivy_document(self, flat: dict) -> tantivy.Document:
        """Convert a flat field/value dict into a Tantivy document, skipping None values."""

        document = tantivy.Document()
        for field in self.FIELDS:
            value = flat.get(field.name)
            if value is None:
                continue

            if field.kind == "text":
                document.add_text(field.name, str(value))
            elif field.kind == "integer":
                document.add_integer(field.name, int(value))
            elif field.kind == "date":
                document.add_date(field.name, value)
            elif field.kind == "boolean":
                document.add_boolean(field.name, bool(value))

        return document

    def _to_hit(self, document: tantivy.Document, score: float) -> dict:
        """Build a search hit dict from a stored document, adding `_score` and `_id`."""

        hit = {name: document.get_first(name) for name in self._stored_fields}
        hit["_score"] = score
        hit["_id"] = hit.get(self.ID_FIELD)
        return hit

    def _schema_version(self) -> str:
        """Short hash of the schema; changes whenever ID_FIELD or any FieldSpec changes."""

        spec = repr([(f.name, f.kind, f.stored, f.fast, f.tokenizer) for f in self.FIELDS])
        return hashlib.sha1(f"{self.ID_FIELD}|{spec}".encode()).hexdigest()[:16]


def list_index_entities(namespace: Namespace) -> list[str]:
    """Return the entity names of the Tantivy indexes directly under `namespace`'s directory.

    Each `SearchStore` writes its index to ``<base>/<namespace>/<entity>``, so a namespace's
    directory holds one sub-directory per indexed entity. Used by tooling (the Store Entry
    browser) to discover a namespace's indexes without knowing their subclasses.
    """

    namespace_path = resolve_namespace_path(get_search_base_path(), namespace)
    if not os.path.isdir(namespace_path):
        return []

    entities = [
        entry.name
        for entry in os.scandir(namespace_path)
        if entry.is_dir(follow_symlinks=False) and tantivy.Index.exists(entry.path)
    ]
    return sorted(entities)


class SearchIndexBrowser:
    """Read-only, schema-agnostic view of one on-disk Tantivy index, for tooling.

    Unlike `SearchStore`, this does not know the index's subclass schema (ENTITY/FIELDS); it
    opens the index with the schema persisted on disk, so any index can be browsed or read
    generically by the Store Entry browser. Stored fields are the only ones a document exposes.
    """

    # Field preferred as the human-facing document key when a document stores it.
    KEY_FIELD: ClassVar[str] = "id"

    def __init__(self, namespace: Namespace, entity: str) -> None:
        # Unlike SearchStore, which joins its own ENTITY constant, the entity here comes from a
        # Store Entry record name and can be anything. resolve_namespace_path already keeps the
        # namespace inside the base path; the entity has to be held to one component too, or a
        # value like "../../.." would walk out of the site's own index directory.
        if not entity or entity in (".", "..") or "/" in entity or os.sep in entity:
            raise ValueError(f"invalid index entity: {entity!r}")

        namespace_path = resolve_namespace_path(get_search_base_path(), namespace)
        self.path = os.path.join(namespace_path, entity)

    def count(self) -> int:
        """Return the number of documents in the index (0 when it has not been created yet)."""

        searcher = self._searcher()
        return searcher.num_docs if searcher else 0

    def browse(self, limit: int | None = None) -> list[dict]:
        """List documents as ``{key, size}`` (stored fields only), for the Store Entry browser."""

        return [
            {"key": self._key(fields), "size": _document_size(fields)}
            for fields in self._documents(limit=limit)
        ]

    def read(self, key: str) -> dict | None:
        """Return ``{value, size}`` for the document whose key is `key`, or None if it is absent.

        `value` is the document's stored fields, flattened to scalars where a field holds a single
        value. Scans the index because the key is a stored value, not necessarily an indexed term.
        """

        for fields in self._documents():
            if self._key(fields) == key:
                return {"value": _flatten(fields), "size": _document_size(fields)}

        return None

    def _searcher(self) -> tantivy.Searcher | None:
        """Open the on-disk index with its persisted schema and return a fresh searcher, or None."""

        if not tantivy.Index.exists(self.path):
            return None

        index = tantivy.Index.open(self.path)
        # Pick up commits made since the index files were opened.
        index.reload()
        return index.searcher()

    def _documents(self, limit: int | None = None):
        """Yield each document's stored fields (a ``{name: [values]}`` dict) via a match-all query."""

        searcher = self._searcher()
        if not searcher:
            return

        total = searcher.num_docs
        if not total:
            return

        # Tantivy needs a positive limit; cap it at the document count so a single page covers all.
        page = total if limit is None else min(limit, total)
        result = searcher.search(tantivy.Query.all_query(), limit=page)
        for _score, address in result.hits:
            yield searcher.doc(address).to_dict()

    def _key(self, fields: dict) -> str:
        """Pick a document's key: the `KEY_FIELD` value when present, else the first stored field."""

        values = fields.get(self.KEY_FIELD)
        if values is None and fields:
            values = next(iter(fields.values()))

        return str(values[0]) if values else ""


def _flatten(fields: dict) -> dict:
    """Collapse Tantivy's ``{name: [values]}`` into scalars where a field holds a single value."""

    return {name: (values[0] if len(values) == 1 else values) for name, values in fields.items()}


def _document_size(fields: dict) -> int:
    """Approximate a stored document's size as the byte length of its normalized JSON."""

    return len(json.dumps(_flatten(fields), ensure_ascii=False, default=str).encode())
