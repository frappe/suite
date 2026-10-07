import re
import socket

import frappe
from frappe import _


def get_host_by_ip(ip_address: str, raise_exception: bool = False) -> str | None:
    """Returns host for the given IP address."""

    err_msg = None

    try:
        return socket.gethostbyaddr(ip_address)[0]
    except Exception as e:
        err_msg = _(str(e))

    if raise_exception and err_msg:
        frappe.throw(err_msg)


def parse_dns_zone_file(zone_file: str) -> list[dict]:
    """Parses a DNS zone file content and returns a list of DNS records with their components."""

    # ------------------------------------------------------------
    # Step 1: Merge multiline DNS records
    # ------------------------------------------------------------
    merged_records = []
    buffer = []
    inside_multiline = False

    for line in zone_file.splitlines():
        line = line.strip()

        if not line:
            continue

        if "(" in line:
            inside_multiline = True

        buffer.append(line)

        if inside_multiline:
            if ")" in line:
                merged_records.append(" ".join(buffer))
                buffer = []
                inside_multiline = False
        else:
            merged_records.append(line)
            buffer = []

    # Safety: flush remaining buffer
    if buffer:
        merged_records.append(" ".join(buffer))

    # ------------------------------------------------------------
    # Step 2: Parse records
    # ------------------------------------------------------------
    dns_records = []

    for record in merged_records:
        # Remove multiline parentheses
        record = record.replace("(", "").replace(")", "").strip()

        # Normalize multiple spaces
        record = re.sub(r"\s+", " ", record)

        parts = record.split()

        # Minimum valid structure:
        # name IN TYPE value
        if len(parts) < 4:
            continue

        name = parts[0]

        # Handle optional TTL
        #
        # Formats:
        # example.com. 3600 IN TXT "value"
        # example.com. IN TXT "value"
        #
        if re.fullmatch(r"\d+", parts[1]):
            ttl = parts[1]
            record_class = parts[2]
            record_type = parts[3]
            value = " ".join(parts[4:])
        else:
            ttl = None
            record_class = parts[1]
            record_type = parts[2]
            value = " ".join(parts[3:])

        # Merge adjacent quoted TXT chunks:
        # "abc" "def" -> "abcdef"
        if record_type == "TXT":
            quoted_parts = re.findall(r'"([^"]*)"', value)

            if quoted_parts:
                value = "".join(quoted_parts)

        dns_records.append(
            {
                "name": name,
                "ttl": ttl,
                "class": record_class,
                "type": record_type,
                "value": value,
            }
        )

    return dns_records


class ZoneFileRecord:
    """A DNS record as the zone file line that Route 53's importer accepts, as BIND-style ones do."""

    DEFAULT_TTL = 300  # Route 53 refuses a line without a TTL
    TXT_STRING_LENGTH = 255  # the longest string a TXT record may carry

    def __init__(self, record: dict) -> None:
        self.record = record

    def __str__(self) -> str:
        record = self.record
        ttl = record.get("ttl") or self.DEFAULT_TTL
        return f"{record['fqdn']}.\t{ttl}\tIN\t{record['type']}\t{self.rdata}"

    @property
    def rdata(self) -> str:
        record = self.record
        if record["type"] == "MX":
            return f"{record.get('priority') or 10} {self.target}"
        if record["type"] == "SRV":
            priority, weight, port = (record.get(field) or 0 for field in ("priority", "weight", "port"))
            return f"{priority} {weight} {port} {self.target}"
        if record["type"] == "CNAME":
            return self.target
        if record["type"] == "TXT":
            return self.text
        return record["value"]

    @property
    def target(self) -> str:
        """The hostname with a trailing dot: importers append the zone's own name to one without."""

        return f"{self.record['value'].rstrip('.')}."

    @property
    def text(self) -> str:
        """The value as quoted strings, several when it is too long for one (an RSA DKIM key is).

        The strings touch: Route 53's importer reads strings a space apart as separate values and
        refuses the line.
        """

        value = self.record["value"]
        length = self.TXT_STRING_LENGTH
        strings = [value[start : start + length] for start in range(0, len(value), length)]
        return "".join(f'"{_escape_quoted(string)}"' for string in strings)


def _escape_quoted(string: str) -> str:
    return string.replace("\\", "\\\\").replace('"', '\\"')
