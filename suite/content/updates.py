"""A strict reader for Yjs v1 updates, in pure Python, so no native code sees a row first.

It reads what the compaction's guards need: each struct's writer and clocks,
its origins, the text it inserts, the names it carries, and the delete set. Anything malformed,
including trailing bytes, raises `ValueError`. `rewrite_values` copies an update
with its values changed and nothing else.

A rewrite copies text, names, keys, ids, clocks and origins byte for byte, so the
copy holds the same structs and Yjs reads it as the same document with those values
rewritten. Values `rewrite` leaves alone keep their original bytes.
"""

import builtins
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import NoReturn

MAX_SAFE_INTEGER = 2**53 - 1
MAX_DEPTH = 100
ASTRAL_CHAR = re.compile("[\U00010000-\U0010ffff]")
VARINT_CONTINUE = 0x80
VARINT_LOW_BITS = 0x7F

CONTENT_GC = 0
CONTENT_DELETED = 1
CONTENT_JSON = 2
CONTENT_BINARY = 3
CONTENT_STRING = 4
CONTENT_EMBED = 5
CONTENT_FORMAT = 6
CONTENT_TYPE = 7
CONTENT_ANY = 8
CONTENT_DOC = 9
CONTENT_SKIP = 10

ANY_UNDEFINED = 127
ANY_NULL = 126
ANY_INTEGER = 125
ANY_FLOAT32 = 124
ANY_FLOAT64 = 123
ANY_BIGINT = 122
ANY_TRUE = 121
ANY_FALSE = 120
ANY_STRING = 119
ANY_OBJECT = 118
ANY_ARRAY = 117
ANY_BINARY = 116


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
        """Answer the ids this struct needs before it can integrate: its origins and its parent item."""
        return [ref for ref in (self.origin, self.right_origin, self.parent) if ref]


@dataclass
class Update:
    structs: list[Struct] = field(default_factory=list)
    deletes: dict[int, list[tuple[int, int]]] = field(default_factory=dict)

    @property
    def names(self) -> set[str]:
        """Answer every name the structs carry."""
        names: set[str] = set()
        for struct in self.structs:
            names.update(struct.names)

        return names

    def split_points(self) -> set[tuple[int, int]]:
        """Answer where this update can split a struct: after origins, at right origins, at delete ends."""
        points: set[tuple[int, int]] = set()
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

    def __init__(self, buffer: bytes) -> None:
        self.buffer = buffer
        self.position = 0

    def byte(self) -> int:
        """Read one byte."""
        if self.position >= len(self.buffer):
            raise ValueError("unexpected end of update")

        self.position += 1
        return self.buffer[self.position - 1]

    def uint(self) -> int:
        """Read an unsigned varint, refusing one past `MAX_SAFE_INTEGER`."""
        value = 0
        factor = 1
        while True:
            byte = self.byte()
            value += (byte & VARINT_LOW_BITS) * factor
            factor *= 128
            if value > MAX_SAFE_INTEGER:
                raise ValueError("integer out of range")

            if byte < VARINT_CONTINUE:
                return value

    def skip_signed(self) -> None:
        """Read past a signed varint, refusing one past `MAX_SAFE_INTEGER`."""
        byte = self.byte()
        value = byte & 0x3F
        factor = 64
        if byte & VARINT_CONTINUE == 0:
            return

        while True:
            byte = self.byte()
            value += (byte & VARINT_LOW_BITS) * factor
            factor *= 128
            if value > MAX_SAFE_INTEGER:
                raise ValueError("integer out of range")

            if byte < VARINT_CONTINUE:
                return

    def read_bytes(self, length: builtins.int) -> bytes:
        """Read the next `length` bytes."""
        if self.position + length > len(self.buffer):
            raise ValueError("unexpected end of update")

        self.position += length
        return self.buffer[self.position - length : self.position]

    def string(self) -> str:
        """Read a length-prefixed UTF-8 string."""
        length = self.uint()
        return self.read_bytes(length).decode("utf-8")

    def json(self) -> object:
        """Read a string and load the JSON it holds."""
        return checked_json(self.string())

    def id(self) -> tuple[builtins.int, builtins.int]:
        """Read a struct id: its writer and clock."""
        return self.uint(), self.uint()


def refuse_constant(name: str) -> NoReturn:
    """Refuse a constant such as `NaN`, which JSON doesn't allow."""
    raise ValueError(f"not JSON: {name}")


def checked_json(text: str) -> object:
    """Load the JSON in `text`, refusing a value nested past `MAX_DEPTH`, so later walks can recurse."""
    try:
        parsed = json.loads(text, parse_constant=refuse_constant)
    except RecursionError:
        raise ValueError("value nested too deep") from None

    containers = [(parsed, 0)]
    while containers:
        value, depth = containers.pop()
        if depth >= MAX_DEPTH:
            raise ValueError("value nested too deep")

        items: Iterable[object] = ()
        if isinstance(value, dict):
            items = value.values()
        elif isinstance(value, list):
            items = value

        containers.extend((item, depth + 1) for item in items if isinstance(item, dict | list))

    return parsed


def string_length(struct: Struct, text: str) -> int:
    """Count the text's UTF-16 code units, the way Yjs counts clocks, noting where each pair splits."""
    surrogate_count = 0
    for astral_match in ASTRAL_CHAR.finditer(text):
        struct.pairs.append(struct.clock + astral_match.start() + surrogate_count + 1)
        surrogate_count += 1

    return len(text) + surrogate_count


def read_client_structs(reader: Reader, struct_count: int, client: int, clock: int) -> list[Struct]:
    """Read one writer's structs from `clock` on, refusing an empty one or a clock out of range."""
    structs: list[Struct] = []
    for _struct in range(struct_count):
        struct = read_struct(reader, client, clock)
        if struct.length == 0:
            raise ValueError("empty struct")

        clock += struct.length
        if clock > MAX_SAFE_INTEGER:
            raise ValueError("clock out of range")

        structs.append(struct)

    return structs


def read_structs(reader: Reader) -> list[Struct]:
    """Read every writer's structs, refusing a writer that appears twice."""
    structs: list[Struct] = []
    seen_clients: set[int] = set()
    for _section in range(reader.uint()):
        struct_count = reader.uint()
        client = reader.uint()
        clock = reader.uint()
        if client in seen_clients:
            raise ValueError("a client appears twice")

        seen_clients.add(client)
        structs.extend(read_client_structs(reader, struct_count, client, clock))

    return structs


def read_delete_ranges(reader: Reader) -> list[tuple[int, int]]:
    """Read one writer's delete ranges, refusing an empty one or one ending out of range."""
    ranges: list[tuple[int, int]] = []
    for _range in range(reader.uint()):
        clock = reader.uint()
        length = reader.uint()
        if length == 0:
            raise ValueError("empty delete range")

        if clock + length > MAX_SAFE_INTEGER:
            raise ValueError("clock out of range")

        ranges.append((clock, length))

    return ranges


def read_deletes(reader: Reader) -> dict[int, list[tuple[int, int]]]:
    """Read the delete set, each writer's ranges in the order written."""
    deletes: dict[int, list[tuple[int, int]]] = {}
    for _section in range(reader.uint()):
        client = reader.uint()
        ranges = deletes.setdefault(client, [])
        ranges.extend(read_delete_ranges(reader))

    return deletes


def parse(payload: bytes) -> Update:
    """Parse a whole Yjs v1 update, raising `ValueError` on anything malformed or trailing."""
    reader = Reader(payload)
    structs = read_structs(reader)
    deletes = read_deletes(reader)
    if reader.position != len(payload):
        raise ValueError("trailing bytes")

    return Update(structs, deletes)


def read_header(reader: Reader, info: int, struct: Struct) -> None:
    """Read a struct's origins, or its parent and parent key when it has neither."""
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


def read_struct(reader: Reader, client: int, clock: int) -> Struct:
    """Read the struct at `clock`: its header and its content."""
    info = reader.byte()
    content_ref = info & 0x1F
    if content_ref in {CONTENT_GC, CONTENT_SKIP}:
        length = reader.uint()
        return Struct(client, clock, length, content_ref)

    struct = Struct(client, clock, 0, content_ref)
    read_header(reader, info, struct)
    struct.length = read_content(reader, content_ref, struct)
    return struct


def read_json_values(reader: Reader) -> int:
    """Read a JSON content's values, each JSON or `undefined`, and answer how many."""
    count = reader.uint()
    for _item in range(count):
        value = reader.string()
        if value != "undefined":
            checked_json(value)

    return count


def read_format(reader: Reader, struct: Struct) -> None:
    """Read a format item's key and attributes, noting the mark and attribute names."""
    # A mark that may overlap itself is keyed `name--<hash>`
    struct.format_key = reader.string()
    mark_name, *_ = struct.format_key.split("--", 1)
    struct.names.append(mark_name)
    attributes = reader.json()
    if isinstance(attributes, dict):
        struct.names.extend(attributes)


def read_type(reader: Reader, struct: Struct) -> None:
    """Read a type item's shared type, and the node name an XmlElement or XmlHook carries."""
    struct.type = reader.uint()
    if struct.type in {3, 5}:
        struct.node = reader.string()
        struct.names.append(struct.node)
    elif struct.type not in {0, 1, 2, 4, 6}:
        raise ValueError(f"unknown type {struct.type}")


def read_any_values(reader: Reader) -> int:
    """Read an any content's values and answer how many."""
    count = reader.uint()
    for _item in range(count):
        read_any(reader)

    return count


def read_content(reader: Reader, content_ref: int, struct: Struct) -> int:
    """Read a struct's content and answer its length in clocks."""
    if content_ref == CONTENT_DELETED:
        return reader.uint()

    if content_ref == CONTENT_JSON:
        return read_json_values(reader)

    if content_ref == CONTENT_BINARY:
        reader.read_bytes(reader.uint())
        return 1

    if content_ref == CONTENT_STRING:
        return string_length(struct, reader.string())

    if content_ref == CONTENT_EMBED:
        reader.json()
        return 1

    if content_ref == CONTENT_FORMAT:
        read_format(reader, struct)
        return 1

    if content_ref == CONTENT_TYPE:
        read_type(reader, struct)
        return 1

    if content_ref == CONTENT_ANY:
        return read_any_values(reader)

    if content_ref == CONTENT_DOC:
        reader.string()
        read_any(reader)
        return 1

    raise ValueError(f"unknown content {content_ref}")


def read_container(reader: Reader, tag: int, depth: int) -> None:
    """Read an object's or array's entries, refusing nesting past `MAX_DEPTH`."""
    if depth >= MAX_DEPTH:
        raise ValueError("value nested too deep")

    for _item in range(reader.uint()):
        if tag == ANY_OBJECT:
            reader.string()

        read_any(reader, depth + 1)


def read_any(reader: Reader, depth: int = 0) -> None:
    """Read one any value, refusing an unknown tag."""
    tag = reader.byte()
    if tag in {ANY_UNDEFINED, ANY_NULL, ANY_TRUE, ANY_FALSE}:
        return

    if tag == ANY_INTEGER:
        reader.skip_signed()
    elif tag == ANY_FLOAT32:
        reader.read_bytes(4)
    elif tag in {ANY_FLOAT64, ANY_BIGINT}:
        reader.read_bytes(8)
    elif tag == ANY_STRING:
        reader.string()
    elif tag in {ANY_OBJECT, ANY_ARRAY}:
        read_container(reader, tag, depth)
    elif tag == ANY_BINARY:
        length = reader.uint()
        reader.read_bytes(length)
    else:
        raise ValueError(f"unknown value tag {tag}")


@dataclass
class ValueRewrite:
    """A copy of an update in the making, each changed value spliced over its original bytes."""

    data: bytes
    rewrite: Callable[[str], str]
    reader: Reader
    copy: bytearray = field(default_factory=bytearray)
    copied_up_to: int = 0

    def replace_value(self, start: int, value: bytes) -> None:
        """Splice `value` over the bytes from `start` to the reader's position when they differ."""
        if value != self.data[start : self.reader.position]:
            self.copy.extend(self.data[self.copied_up_to : start])
            self.copy.extend(value)
            self.copied_up_to = self.reader.position

    def replace_json(self, start: int, text: str) -> None:
        """Splice JSON `text`, read from `start`, with its strings rewritten."""
        rewritten = rewritten_json(text, self.rewrite)
        self.replace_value(start, encoded_string(rewritten))

    def rewrite_json_values(self) -> None:
        """Rewrite a JSON content's values, leaving `undefined` as written."""
        for _item in range(self.reader.uint()):
            start = self.reader.position
            value = self.reader.string()
            if value != "undefined":
                self.replace_json(start, value)

    def rewrite_any_values(self) -> None:
        """Rewrite an any content's values."""
        for _item in range(self.reader.uint()):
            start = self.reader.position
            rewritten_value = rewritten_any(self.reader, self.rewrite)
            self.replace_value(start, rewritten_value)

    def rewrite_content(self, content_ref: int) -> None:
        """Read a struct's content, rewriting attribute, mark, embed and any values."""
        reader = self.reader
        if content_ref == CONTENT_JSON:
            self.rewrite_json_values()
        elif content_ref == CONTENT_EMBED:
            start = reader.position
            value = reader.string()
            self.replace_json(start, value)
        elif content_ref == CONTENT_FORMAT:
            reader.string()
            start = reader.position
            value = reader.string()
            self.replace_json(start, value)
        elif content_ref == CONTENT_ANY:
            self.rewrite_any_values()
        else:
            read_content(reader, content_ref, Struct(0, 0, 0))

    def rewrite_struct(self) -> None:
        """Read one struct, rewriting its values; GC and Skip hold none."""
        info = self.reader.byte()
        content_ref = info & 0x1F
        if content_ref in {CONTENT_GC, CONTENT_SKIP}:
            self.reader.uint()
            return

        read_header(self.reader, info, Struct(0, 0, 0))
        self.rewrite_content(content_ref)

    def rewrite_structs(self) -> None:
        """Read every writer's structs, rewriting their values."""
        reader = self.reader
        for _section in range(reader.uint()):
            count = reader.uint()
            reader.uint(), reader.uint()
            for _struct in range(count):
                self.rewrite_struct()

    def finished(self) -> bytes:
        """Answer the copy, closed with the bytes after the last changed value."""
        self.copy.extend(self.data[self.copied_up_to :])
        return bytes(self.copy)


def rewrite_values(data: bytes, rewrite: Callable[[str], str]) -> bytes:
    """Copy `data` with every string inside an attribute, mark or embed value passed through `rewrite`."""
    parse(data)
    value_rewrite = ValueRewrite(data, rewrite, Reader(data))
    value_rewrite.rewrite_structs()
    return value_rewrite.finished()


def rewritten_json(text: str, rewrite: Callable[[str], str]) -> str:
    """Answer JSON `text` with its strings rewritten, or `text` itself when none changed."""

    def rewrite_strings(value: object) -> object:
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
    if tag == ANY_STRING:
        text = reader.string()
        rewritten = rewrite(text)
        return bytes([tag]) + encoded_string(rewritten)

    if tag == ANY_OBJECT:
        count = reader.uint()
        out = bytearray([tag]) + encoded_uint(count)
        for _key in range(count):
            key_start = reader.position
            reader.string()
            key = reader.buffer[key_start : reader.position]
            value = rewritten_any(reader, rewrite)
            out += key + value

        return bytes(out)

    if tag == ANY_ARRAY:
        count = reader.uint()
        out = bytearray([tag]) + encoded_uint(count)
        for _item in range(count):
            out += rewritten_any(reader, rewrite)

        return bytes(out)

    reader.position = start
    read_any(reader)
    return reader.buffer[start : reader.position]


def encoded_string(text: str) -> bytes:
    """Encode `text` as a length-prefixed UTF-8 string."""
    utf8 = text.encode("utf-8")
    return encoded_uint(len(utf8)) + utf8


def encoded_uint(value: int) -> bytes:
    """Encode `value` as an unsigned varint."""
    encoded = bytearray()
    while value > VARINT_LOW_BITS:
        encoded.append(VARINT_CONTINUE | (value & VARINT_LOW_BITS))
        value >>= 7

    encoded.append(value)
    return bytes(encoded)
