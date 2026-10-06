"""A strict reader for Yjs v1 updates, in pure Python, so no native code sees a row first.

It reads what the compaction's guards need: each struct's writer and clocks,
its origins, the text it inserts, the names it carries, and the delete set. Anything malformed,
including trailing bytes, raises `ValueError`. `rewrite_values` copies an update
with its values changed and nothing else.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field

MAX_SAFE = 2**53 - 1
MAX_DEPTH = 100
ASTRAL = re.compile("[\U00010000-\U0010ffff]")


@dataclass
class Struct:
    client: int
    clock: int
    length: int
    # The content ref from the info byte: 0 for GC, 10 for Skip
    kind: int = 0
    origin: tuple[int, int] | None = None
    right_origin: tuple[int, int] | None = None
    parent: tuple[int, int] | None = None
    # Clocks that fall between the two halves of a surrogate pair in a string item's text
    pairs: list[int] = field(default_factory=list)
    # Root, node, mark, attribute and map key names, which the editor's schema must declare
    names: list[str] = field(default_factory=list)

    def refs(self) -> list[tuple[int, int]]:
        """The ids this struct needs before it can integrate: its origins and its parent item."""
        return [ref for ref in (self.origin, self.right_origin, self.parent) if ref]


@dataclass
class Update:
    structs: list[Struct] = field(default_factory=list)
    deletes: dict[int, list[tuple[int, int]]] = field(default_factory=dict)

    @property
    def names(self) -> set[str]:
        return {name for struct in self.structs for name in struct.names}

    def split_points(self) -> set[tuple[int, int]]:
        """Every position where this update can split an existing struct: after each origin, at each right
        origin, and at both ends of each delete range."""
        points = set()
        for struct in self.structs:
            if struct.origin:
                points.add((struct.origin[0], struct.origin[1] + 1))
            if struct.right_origin:
                points.add(struct.right_origin)
        for client, ranges in self.deletes.items():
            for clock, length in ranges:
                points |= {(client, clock), (client, clock + length)}
        return points


class Reader:
    __slots__ = ("at", "data")

    def __init__(self, data: bytes):
        self.data = data
        self.at = 0

    def byte(self) -> int:
        if self.at >= len(self.data):
            raise ValueError("unexpected end of update")
        self.at += 1
        return self.data[self.at - 1]

    def uint(self) -> int:
        value, factor = 0, 1
        while True:
            byte = self.byte()
            value += (byte & 0x7F) * factor
            factor *= 128
            if value > MAX_SAFE:
                raise ValueError("integer out of range")
            if byte < 0x80:
                return value

    def int(self) -> None:
        byte = self.byte()
        value, factor = byte & 0x3F, 64
        if byte & 0x80 == 0:
            return
        while True:
            byte = self.byte()
            value += (byte & 0x7F) * factor
            factor *= 128
            if value > MAX_SAFE:
                raise ValueError("integer out of range")
            if byte < 0x80:
                return

    def raw(self, length: int) -> bytes:
        if self.at + length > len(self.data):
            raise ValueError("unexpected end of update")
        self.at += length
        return self.data[self.at - length : self.at]

    def string(self) -> str:
        return self.raw(self.uint()).decode("utf-8")

    def json(self):
        return checked_json(self.string())

    def id(self) -> tuple[int, int]:
        return self.uint(), self.uint()


def refuse_constant(name: str):
    raise ValueError(f"not JSON: {name}")


def checked_json(text: str):
    """The value `text` holds, refusing text that is not JSON or nests deeper than a value may, so later
    walks over it can recurse."""
    try:
        parsed = json.loads(text, parse_constant=refuse_constant)
    except RecursionError:
        raise ValueError("value nested too deep") from None
    containers = [(parsed, 0)]
    while containers:
        value, depth = containers.pop()
        if depth >= MAX_DEPTH:
            raise ValueError("value nested too deep")
        items = value.values() if isinstance(value, dict) else value if isinstance(value, list) else ()
        containers.extend((item, depth + 1) for item in items if isinstance(item, dict | list))
    return parsed


def string_length(struct: Struct, text: str) -> int:
    """The text's length in UTF-16 code units, the way Yjs counts clocks, noting where each pair splits."""
    extra = 0
    for found in ASTRAL.finditer(text):
        struct.pairs.append(struct.clock + found.start() + extra + 1)
        extra += 1
    return len(text) + extra


def parse(data: bytes) -> Update:
    reader = Reader(data)
    update = Update()
    seen = set()
    for _section in range(reader.uint()):
        count, client, clock = reader.uint(), reader.uint(), reader.uint()
        if client in seen:
            raise ValueError("a client appears twice")
        seen.add(client)
        for _struct in range(count):
            struct = read_struct(reader, client, clock)
            if struct.length == 0:
                raise ValueError("empty struct")
            clock += struct.length
            if clock > MAX_SAFE:
                raise ValueError("clock out of range")
            update.structs.append(struct)
    for _section in range(reader.uint()):
        client = reader.uint()
        ranges = update.deletes.setdefault(client, [])
        for _range in range(reader.uint()):
            clock, length = reader.uint(), reader.uint()
            if length == 0:
                raise ValueError("empty delete range")
            if clock + length > MAX_SAFE:
                raise ValueError("clock out of range")
            ranges.append((clock, length))
    if reader.at != len(data):
        raise ValueError("trailing bytes")
    return update


def read_struct(reader: Reader, client: int, clock: int) -> Struct:
    info = reader.byte()
    ref = info & 0x1F
    if ref in (0, 10):  # GC and Skip
        return Struct(client, clock, reader.uint(), ref)
    struct = Struct(client, clock, 0, ref)
    if info & 0x80:
        struct.origin = reader.id()
    if info & 0x40:
        struct.right_origin = reader.id()
    if info & 0xC0 == 0:
        if reader.uint() == 1:
            struct.names.append(reader.string())
        else:
            struct.parent = reader.id()
        if info & 0x20:
            struct.names.append(reader.string())
    struct.length = read_content(reader, ref, struct)
    return struct


def read_content(reader: Reader, ref: int, struct: Struct) -> int:
    if ref == 1:  # deleted
        return reader.uint()
    if ref == 2:  # JSON
        count = reader.uint()
        for _item in range(count):
            value = reader.string()
            if value != "undefined":
                checked_json(value)
        return count
    if ref == 3:  # binary
        reader.raw(reader.uint())
        return 1
    if ref == 4:  # string
        return string_length(struct, reader.string())
    if ref == 5:  # embed
        reader.json()
        return 1
    if ref == 6:  # format
        # A mark that may overlap itself is keyed `name--<hash>`
        struct.names.append(reader.string().split("--", 1)[0])
        attributes = reader.json()
        if isinstance(attributes, dict):
            struct.names.extend(attributes)
        return 1
    if ref == 7:  # type
        kind = reader.uint()
        if kind in (3, 5):
            struct.names.append(reader.string())
        elif kind not in (0, 1, 2, 4, 6):
            raise ValueError(f"unknown type {kind}")
        return 1
    if ref == 8:  # any
        count = reader.uint()
        for _item in range(count):
            read_any(reader)
        return count
    if ref == 9:  # subdocument
        reader.string()
        read_any(reader)
        return 1
    raise ValueError(f"unknown content {ref}")


def read_any(reader: Reader, depth: int = 0) -> None:
    tag = reader.byte()
    if tag in (127, 126, 121, 120):  # undefined, null, true, false
        return
    if tag == 125:
        reader.int()
    elif tag == 124:
        reader.raw(4)
    elif tag in (123, 122):
        reader.raw(8)
    elif tag == 119:
        reader.string()
    elif tag in (118, 117):  # object, array
        if depth >= MAX_DEPTH:
            raise ValueError("value nested too deep")
        for _item in range(reader.uint()):
            if tag == 118:
                reader.string()
            read_any(reader, depth + 1)
    elif tag == 116:
        reader.raw(reader.uint())
    else:
        raise ValueError(f"unknown value tag {tag}")


def rewrite_values(data: bytes, rewrite: Callable[[str], str]) -> bytes:
    """A copy of `data` with every string inside an attribute, mark or embed value passed through `rewrite`.

    Text, names, keys, ids, clocks and origins are copied byte for byte, so the copy
    holds the same structs and Yjs reads it as the same document with those values
    rewritten. Values `rewrite` leaves alone keep their original bytes.
    """
    parse(data)
    reader = Reader(data)
    out = bytearray()
    copied = 0

    def replace(start: int, value: bytes) -> None:
        nonlocal copied
        if value != data[start : reader.at]:
            out.extend(data[copied:start])
            out.extend(value)
            copied = reader.at

    for _section in range(reader.uint()):
        count = reader.uint()
        reader.uint(), reader.uint()
        for _struct in range(count):
            info = reader.byte()
            ref = info & 0x1F
            if ref in (0, 10):
                reader.uint()
                continue
            if info & 0x80:
                reader.id()
            if info & 0x40:
                reader.id()
            if info & 0xC0 == 0:
                if reader.uint() == 1:
                    reader.string()
                else:
                    reader.id()
                if info & 0x20:
                    reader.string()
            if ref == 2:  # JSON
                for _item in range(reader.uint()):
                    start = reader.at
                    value = reader.string()
                    if value != "undefined":
                        replace(start, encoded_string(rewritten_json(value, rewrite)))
            elif ref == 5:  # embed
                start = reader.at
                replace(start, encoded_string(rewritten_json(reader.string(), rewrite)))
            elif ref == 6:  # format
                reader.string()
                start = reader.at
                replace(start, encoded_string(rewritten_json(reader.string(), rewrite)))
            elif ref == 8:  # any
                for _item in range(reader.uint()):
                    start = reader.at
                    replace(start, rewritten_any(reader, rewrite))
            else:
                read_content(reader, ref, Struct(0, 0, 0))
    out.extend(data[copied:])
    return bytes(out)


def rewritten_json(text: str, rewrite: Callable[[str], str]) -> str:
    def walk(value):
        if isinstance(value, str):
            return rewrite(value)
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        return value

    value = json.loads(text, parse_constant=refuse_constant)
    changed = walk(value)
    return text if changed == value else json.dumps(changed, ensure_ascii=False, separators=(",", ":"))


def rewritten_any(reader: Reader, rewrite: Callable[[str], str]) -> bytes:
    """One value read from `reader`, encoded again with its strings rewritten and everything else as read."""
    start = reader.at
    tag = reader.byte()
    if tag == 119:
        return bytes([tag]) + encoded_string(rewrite(reader.string()))
    if tag == 118:
        out = bytearray([tag]) + encoded_uint(count := reader.uint())
        for _key in range(count):
            key_start = reader.at
            reader.string()
            out += reader.data[key_start : reader.at] + rewritten_any(reader, rewrite)
        return bytes(out)
    if tag == 117:
        out = bytearray([tag]) + encoded_uint(count := reader.uint())
        for _item in range(count):
            out += rewritten_any(reader, rewrite)
        return bytes(out)
    reader.at = start
    read_any(reader)
    return reader.data[start : reader.at]


def encoded_string(text: str) -> bytes:
    raw = text.encode("utf-8")
    return encoded_uint(len(raw)) + raw


def encoded_uint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    out.append(value)
    return bytes(out)
