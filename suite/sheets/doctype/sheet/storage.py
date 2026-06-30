"""Gzip + base64 storage encoding for the Sheet ``sheets_data`` field.

Spreadsheet JSON is highly compressible (repeated format keys, sheet names,
empty-cell padding), so compressing at rest gives roughly 5-10× more effective
headroom for the same row footprint without changing the schema or the client
contract — the API still speaks plain JSON in both directions.

Wire format on disk::

    {"_z": "gzip", "data": "<base64-encoded gzip bytes>"}

Documents written before this change remain plain JSON strings; the decoder
falls back to returning the input unchanged in that case, so existing sheets
keep working and migrate lazily on their next save.
"""

import base64
import binascii
import gzip
import io
import json

# Cap on the *uncompressed* (effective workbook) byte size. This is the real
# constraint: the whole workbook is decompressed and parsed into memory on
# every load, so the uncompressed size — not the on-disk compressed size —
# bounds load RAM and parse time. The client now stores cells in a compact
# row-major form (see frontend/src/utils/sheet-codec.js) that roughly halves
# this number for the same data, so the cap is raised to 75 MB to give real
# headroom (~6M cells of typical data) without inviting sheets so large they
# lag on load.
MAX_SHEETS_DATA_BYTES = 75 * 1024 * 1024

# Hard upper bound on the size of a compressed base64 payload we are willing
# to even *attempt* to decompress. Anything legitimately ≤ MAX_SHEETS_DATA_BYTES
# uncompressed will compress to a small fraction of that — accepting up to the
# raw cap as compressed input keeps a wide safety margin while shutting the
# door on multi-GB envelopes that wedge a worker just decoding base64.
_MAX_COMPRESSED_BYTES = MAX_SHEETS_DATA_BYTES

_GZ_MARKER = "_z"
_GZ_KIND = "gzip"
_DATA_KEY = "data"


def encode_sheets_data(json_str: str) -> str:
	"""Wrap a plain sheets_data JSON string into the on-disk envelope."""
	raw = (json_str or "{}").encode("utf-8")
	compressed = gzip.compress(raw, compresslevel=6)
	payload = base64.b64encode(compressed).decode("ascii")
	return json.dumps({_GZ_MARKER: _GZ_KIND, _DATA_KEY: payload})


def decode_sheets_data(stored: str | None) -> str:
	"""Unwrap a stored envelope back into a plain JSON string.

	Pre-compression values pass through unchanged. Decompression is bounded
	by ``MAX_SHEETS_DATA_BYTES`` to defuse gzip-bomb payloads — a tiny
	envelope that expands to gigabytes raises rather than allocating
	the full output buffer.
	"""
	if not stored:
		return "{}"
	envelope = _try_parse_envelope(stored)
	if envelope is None:
		return stored
	return _bounded_decompress(envelope[_DATA_KEY]).decode("utf-8")


def effective_size(stored: str | None) -> int:
	"""Return the uncompressed byte size of a stored value (envelope-aware).

	Bounded by the same cap as :func:`decode_sheets_data` so callers can't be
	OOM'd by probing an oversized envelope.
	"""
	if not stored:
		return 0
	envelope = _try_parse_envelope(stored)
	if envelope is None:
		return len(stored.encode("utf-8"))
	return len(_bounded_decompress(envelope[_DATA_KEY]))


def _bounded_decompress(b64_payload: str) -> bytes:
	"""Decode + decompress a base64 gzip payload with a hard size ceiling.

	Raises a Frappe-flavoured error if the compressed input or the
	decompressed output exceeds ``MAX_SHEETS_DATA_BYTES``. Imported lazily
	to avoid pulling `frappe` into pure-storage callers (tests, patches).
	"""
	# Reject oversized base64 input up front — len(b64) ≈ 4/3 × len(decoded),
	# so a string longer than 4/3 × _MAX_COMPRESSED_BYTES can't fit.
	if not isinstance(b64_payload, str) or len(b64_payload) > _MAX_COMPRESSED_BYTES * 2:
		_throw_bomb()
	try:
		compressed = base64.b64decode(b64_payload, validate=True)
	except (binascii.Error, ValueError):
		_throw_bomb(reason="invalid base64 in sheets_data envelope")
	if len(compressed) > _MAX_COMPRESSED_BYTES:
		_throw_bomb()
	# Stream-decompress at most ``MAX_SHEETS_DATA_BYTES``, then peek one more
	# byte — if there's anything past the cap we reject without ever
	# materialising the full bomb in memory.
	try:
		with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as gz:
			out = gz.read(MAX_SHEETS_DATA_BYTES)
			if gz.read(1):
				_throw_bomb()
	except (OSError, EOFError):
		_throw_bomb(reason="malformed gzip envelope in sheets_data")
	return out


def _throw_bomb(reason: str | None = None) -> None:
	import frappe

	limit_mb = MAX_SHEETS_DATA_BYTES // (1024 * 1024)
	frappe.throw(
		reason
		or (
			f"This spreadsheet is too large to save (over {limit_mb} MB uncompressed). "
			f"This usually comes from formatting applied across a very large range — "
			f"clear formatting you don't need, or split the data across sheets."
		)
	)


def _try_parse_envelope(stored: str) -> dict | None:
	"""Return the envelope dict iff `stored` matches our wire format."""
	try:
		obj = json.loads(stored)
	except (ValueError, TypeError):
		return None
	if (
		isinstance(obj, dict)
		and obj.get(_GZ_MARKER) == _GZ_KIND
		and isinstance(obj.get(_DATA_KEY), str)
	):
		return obj
	return None
