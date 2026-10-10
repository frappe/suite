"""A strict reader for Yjs v1 updates, in pure Python, so no native code sees a row first.

It reads what the compaction's guards need: each struct's writer and clocks,
its origins, the text it inserts, the names it carries, and the delete set. Anything malformed,
including trailing bytes, raises `ValueError`. `rewrite_values` copies an update
with its values changed and nothing else.
"""

import builtins
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field

MAX_SAFE_INTEGER = 2**53 - 1
MAX_DEPTH = 100
ASTRAL_CHAR = re.compile("[\U00010000-\U0010ffff]")


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
    # The root type's name, for a struct whose parent is a root
    root: str | None = None
    # For a type item, the shared type it holds: 0 Array, 1 Map, 2 Text, 3 XmlElement, 4 XmlFragment,
    # 5 XmlHook, 6 XmlText
    type: int | None = None
    # An XmlElement's or XmlHook's name, and a format item's key as written
    node: str | None = None
    format_key: str | None = None

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
    __slots__ = ("buffer", "position")

    def __init__(self, buffer: bytes):
        self.buffer = buffer
        self.position = 0

    def byte(self) -> int:
        if self.position >= len(self.buffer):
            raise ValueError("unexpected end of update")

        self.position += 1
        return self.buffer[self.position - 1]

    def uint(self) -> int:
        value, factor = 0, 1
        while True:
            byte = self.byte()
            value += (byte & 0x7F) * factor
            factor *= 128
            if value > MAX_SAFE_INTEGER:
                raise ValueError("integer out of range")

            if byte < 0x80:
                return value

    def skip_signed(self) -> None:
        byte = self.byte()
        value, factor = byte & 0x3F, 64
        if byte & 0x80 == 0:
            return

        while True:
            byte = self.byte()
            value += (byte & 0x7F) * factor
            factor *= 128
            if value > MAX_SAFE_INTEGER:
                raise ValueError("integer out of range")

            if byte < 0x80:
                return

    def read_bytes(self, length: builtins.int) -> bytes:
        if self.position + length > len(self.buffer):
            raise ValueError("unexpected end of update")

        self.position += length
        return self.buffer[self.position - length : self.position]

    def string(self) -> str:
        length = self.uint()
        return self.read_bytes(length).decode("utf-8")

    def json(self):
        return checked_json(self.string())

    def id(self) -> tuple[builtins.int, builtins.int]:
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

        items = ()
        if isinstance(value, dict):
            items = value.values()
        elif isinstance(value, list):
            items = value
        containers.extend((item, depth + 1) for item in items if isinstance(item, dict | list))

    return parsed


def string_length(struct: Struct, text: str) -> int:
    """The text's length in UTF-16 code units, the way Yjs counts clocks, noting where each pair splits."""
    surrogate_count = 0
    for astral_match in ASTRAL_CHAR.finditer(text):
        struct.pairs.append(struct.clock + astral_match.start() + surrogate_count + 1)
        surrogate_count += 1

    return len(text) + surrogate_count


def parse(payload: bytes) -> Update:
    reader = Reader(payload)
    update = Update()
    seen_clients = set()
    for _section in range(reader.uint()):
        struct_count, client, clock = reader.uint(), reader.uint(), reader.uint()
        if client in seen_clients:
            raise ValueError("a client appears twice")

        seen_clients.add(client)
        for _struct in range(struct_count):
            struct = read_struct(reader, client, clock)
            if struct.length == 0:
                raise ValueError("empty struct")

            clock += struct.length
            if clock > MAX_SAFE_INTEGER:
                raise ValueError("clock out of range")

            update.structs.append(struct)

    for _section in range(reader.uint()):
        client = reader.uint()
        ranges = update.deletes.setdefault(client, [])
        for _range in range(reader.uint()):
            clock, length = reader.uint(), reader.uint()
            if length == 0:
                raise ValueError("empty delete range")

            if clock + length > MAX_SAFE_INTEGER:
                raise ValueError("clock out of range")

            ranges.append((clock, length))

    if reader.position != len(payload):
        raise ValueError("trailing bytes")

    return update


def read_struct(reader: Reader, client: int, clock: int) -> Struct:
    info = reader.byte()
    content_ref = info & 0x1F
    if content_ref in (0, 10):  # GC and Skip
        length = reader.uint()
        return Struct(client, clock, length, content_ref)

    struct = Struct(client, clock, 0, content_ref)
    if info & 0x80:
        struct.origin = reader.id()
    if info & 0x40:
        struct.right_origin = reader.id()
    if info & 0xC0 == 0:
        if reader.uint() == 1:
            struct.root = reader.string()
            struct.names.append(struct.root)
        else:
            struct.parent = reader.id()
        if info & 0x20:
            struct.names.append(reader.string())

    struct.length = read_content(reader, content_ref, struct)
    return struct


def read_content(reader: Reader, content_ref: int, struct: Struct) -> int:
    if content_ref == 1:  # deleted
        return reader.uint()

    if content_ref == 2:  # JSON
        count = reader.uint()
        for _item in range(count):
            value = reader.string()
            if value != "undefined":
                checked_json(value)
        return count

    if content_ref == 3:  # binary
        length = reader.uint()
        reader.read_bytes(length)
        return 1

    if content_ref == 4:  # string
        text = reader.string()
        return string_length(struct, text)

    if content_ref == 5:  # embed
        reader.json()
        return 1

    if content_ref == 6:  # format
        # A mark that may overlap itself is keyed `name--<hash>`
        struct.format_key = reader.string()
        mark_name = struct.format_key.split("--", 1)[0]
        struct.names.append(mark_name)
        attributes = reader.json()
        if isinstance(attributes, dict):
            struct.names.extend(attributes)
        return 1

    if content_ref == 7:  # type
        struct.type = reader.uint()
        if struct.type in (3, 5):
            struct.node = reader.string()
            struct.names.append(struct.node)
        elif struct.type not in (0, 1, 2, 4, 6):
            raise ValueError(f"unknown type {struct.type}")
        return 1

    if content_ref == 8:  # any
        count = reader.uint()
        for _item in range(count):
            read_any(reader)
        return count

    if content_ref == 9:  # subdocument
        reader.string()
        read_any(reader)
        return 1

    raise ValueError(f"unknown content {content_ref}")


def read_any(reader: Reader, depth: int = 0) -> None:
    tag = reader.byte()
    if tag in (127, 126, 121, 120):  # undefined, null, true, false
        return

    if tag == 125:
        reader.skip_signed()
    elif tag == 124:
        reader.read_bytes(4)
    elif tag in (123, 122):
        reader.read_bytes(8)
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
        length = reader.uint()
        reader.read_bytes(length)
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
    rewritten_update = bytearray()
    copied_up_to = 0

    def replace_value(start: int, value: bytes) -> None:
        nonlocal copied_up_to
        if value != data[start : reader.position]:
            rewritten_update.extend(data[copied_up_to:start])
            rewritten_update.extend(value)
            copied_up_to = reader.position

    for _section in range(reader.uint()):
        count = reader.uint()
        reader.uint(), reader.uint()
        for _struct in range(count):
            info = reader.byte()
            content_ref = info & 0x1F
            if content_ref in (0, 10):
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

            if content_ref == 2:  # JSON
                for _item in range(reader.uint()):
                    start = reader.position
                    value = reader.string()
                    if value != "undefined":
                        rewritten = rewritten_json(value, rewrite)
                        replace_value(start, encoded_string(rewritten))
            elif content_ref == 5:  # embed
                start = reader.position
                value = reader.string()
                rewritten = rewritten_json(value, rewrite)
                replace_value(start, encoded_string(rewritten))
            elif content_ref == 6:  # format
                reader.string()
                start = reader.position
                value = reader.string()
                rewritten = rewritten_json(value, rewrite)
                replace_value(start, encoded_string(rewritten))
            elif content_ref == 8:  # any
                for _item in range(reader.uint()):
                    start = reader.position
                    rewritten_value = rewritten_any(reader, rewrite)
                    replace_value(start, rewritten_value)
            else:
                read_content(reader, content_ref, Struct(0, 0, 0))

    rewritten_update.extend(data[copied_up_to:])
    return bytes(rewritten_update)


def rewritten_json(text: str, rewrite: Callable[[str], str]) -> str:
    def rewrite_strings(value):
        if isinstance(value, str):
            return rewrite(value)
        if isinstance(value, list):
            return [rewrite_strings(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite_strings(item) for key, item in value.items()}
        return value

    value = json.loads(text, parse_constant=refuse_constant)
    rewritten = rewrite_strings(value)
    if rewritten == value:
        return text

    return json.dumps(rewritten, ensure_ascii=False, separators=(",", ":"))


def rewritten_any(reader: Reader, rewrite: Callable[[str], str]) -> bytes:
    """One value read from `reader`, encoded again with its strings rewritten and everything else as read."""
    start = reader.position
    tag = reader.byte()
    if tag == 119:
        text = reader.string()
        rewritten = rewrite(text)
        return bytes([tag]) + encoded_string(rewritten)

    if tag == 118:
        count = reader.uint()
        out = bytearray([tag]) + encoded_uint(count)
        for _key in range(count):
            key_start = reader.position
            reader.string()
            key = reader.buffer[key_start : reader.position]
            value = rewritten_any(reader, rewrite)
            out += key + value
        return bytes(out)

    if tag == 117:
        count = reader.uint()
        out = bytearray([tag]) + encoded_uint(count)
        for _item in range(count):
            out += rewritten_any(reader, rewrite)
        return bytes(out)

    reader.position = start
    read_any(reader)
    return reader.buffer[start : reader.position]


def encoded_string(text: str) -> bytes:
    utf8 = text.encode("utf-8")
    return encoded_uint(len(utf8)) + utf8


def encoded_uint(value: int) -> bytes:
    encoded = bytearray()
    while value > 0x7F:
        encoded.append(0x80 | (value & 0x7F))
        value >>= 7

    encoded.append(value)
    return bytes(encoded)
