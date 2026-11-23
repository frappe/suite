# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A small Sieve interpreter, for reading what the automation script does with a message.

It knows the part of Sieve the script is written in and fails on anything else rather than guess:
RFC 5228 control, tests and match types, `fileinto`, imap4flags (RFC 5232), spamtest with relational
(RFC 5235, 5231) and `:regex`. Two things follow the mail server instead of a general reading:
`:regex` compares case as written, as Stalwart's does, and a header's value is unfolded and
trimmed before it is tested.

It cannot tell whether the server accepts a script: `test_automation_sieve_compiles` does that.
"""

import operator
import re
from dataclasses import dataclass
from email.utils import getaddresses

# Where a `keep`, said or implied, leaves the message: the mailbox the server would pick itself.
KEEP = "<keep>"

RELATIONS = {
    "gt": operator.gt,
    "ge": operator.ge,
    "lt": operator.lt,
    "le": operator.le,
    "eq": operator.eq,
    "ne": operator.ne,
}

TOKEN = re.compile(r'\s+|#[^\n]*|"(?:[^"\\]|\\.)*"|:[\w-]+|[\w-]+|[\[\](){},;]')


@dataclass(frozen=True)
class Message:
    """A message as the script sees it: its headers in order, and the server's spam verdict."""

    headers: tuple[tuple[str, str], ...]
    spamtest: int = 1

    def values(self, name: str) -> list[str]:
        return [" ".join(value.split()) for header, value in self.headers if header.lower() == name.lower()]


@dataclass(frozen=True)
class Delivery:
    """Where the script left a message, and the flags it left it with."""

    mailbox: str
    flags: frozenset[str]


class _Stop(Exception):
    pass


class _Run:
    """One run of a script over one message."""

    def __init__(self, script: str, message: Message) -> None:
        if "".join(TOKEN.findall(script)) != script:
            raise AssertionError("The script holds something that is not Sieve.")
        self.tokens = [token for token in TOKEN.findall(script) if token.strip() and token[0] != "#"]
        self.at = 0
        self.message = message
        self.flags: set[str] = set()
        self.delivery: Delivery | None = None

    # Reading

    def peek(self) -> str | None:
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, expected: str | None = None) -> str:
        token = self.tokens[self.at]
        if expected is not None and token != expected:
            raise AssertionError(f"Expected {expected!r}, found {token!r}.")
        self.at += 1
        return token

    def string(self) -> str:
        token = self.take()
        if token[0] != '"':
            raise AssertionError(f"Expected a string, found {token!r}.")
        return re.sub(r"\\(.)", r"\1", token[1:-1])

    def strings(self) -> list[str]:
        if self.peek() != "[":
            return [self.string()]
        self.take("[")
        values = [self.string()]
        while self.peek() == ",":
            self.take(",")
            values.append(self.string())
        self.take("]")
        return values

    # Running

    def run(self) -> Delivery:
        try:
            while self.peek() is not None:
                self.command(live=True)
        except _Stop:
            pass
        # RFC 5232 §2: the implicit keep takes the flags as they stand.
        return self.delivery or Delivery(KEEP, frozenset(self.flags))

    def block(self, live: bool) -> None:
        self.take("{")
        while self.peek() != "}":
            self.command(live)
        self.take("}")

    def command(self, live: bool) -> None:
        name = self.take()
        if name == "if":
            self.conditional(live)
        elif name == "require":
            self.strings()
            self.take(";")
        else:
            self.action(name, live)

    def conditional(self, live: bool) -> None:
        matched = self.test()
        self.block(live and matched)
        while self.peek() == "elsif":
            self.take()
            # Every test is read, so one this interpreter cannot read fails even after a match.
            this = self.test()
            self.block(live and this and not matched)
            matched = matched or this
        if self.peek() == "else":
            self.take()
            self.block(live and not matched)

    def action(self, name: str, live: bool) -> None:
        flags = None
        if name in ("keep", "fileinto") and self.peek() == ":flags":
            self.take()
            # RFC 5232 §5: flags given here are the message's flags, in place of those set so far.
            flags = set(self.strings())
        argument = None if name in ("keep", "stop") else self.string()
        self.take(";")
        if not live:
            return

        if name == "addflag":
            self.flags.add(argument)
        elif name == "stop":
            raise _Stop
        elif name in ("keep", "fileinto"):
            self.delivery = Delivery(argument or KEEP, frozenset(self.flags if flags is None else flags))
        else:
            raise AssertionError(f"Unrecognised Sieve action: {name}")

    def test(self) -> bool:
        name = self.take()
        if name in ("allof", "anyof"):
            self.take("(")
            results = [self.test()]
            while self.peek() == ",":
                self.take(",")
                results.append(self.test())
            self.take(")")
            return all(results) if name == "allof" else any(results)
        if name == "not":
            return not self.test()
        if name == "exists":
            return all(self.message.values(header) for header in self.strings())
        if name == "header":
            match = self.match_type()
            names, keys = self.strings(), self.strings()
            return self.matches(match, [v for header in names for v in self.message.values(header)], keys)
        if name == "address":
            part = self.take() if self.peek() in (":localpart", ":domain", ":all") else ":all"
            match = self.match_type()
            names, keys = self.strings(), self.strings()
            return self.matches(match, [a for header in names for a in self.addresses(header, part)], keys)
        if name == "spamtest":
            self.take(":value")
            relation = RELATIONS[self.string()]
            self.take(":comparator")
            self.take('"i;ascii-numeric"')
            return relation(self.message.spamtest, int(self.string()))
        raise AssertionError(f"Unrecognised Sieve test: {name}")

    def match_type(self) -> str:
        match = self.take()
        if match not in (":is", ":contains", ":matches", ":regex"):
            raise AssertionError(f"Unrecognised match type: {match}")
        return match

    def addresses(self, header: str, part: str) -> list[str]:
        addresses = [address for _name, address in getaddresses(self.message.values(header))]
        if part == ":all":
            return addresses
        return [address.rpartition("@")[0 if part == ":localpart" else 2] for address in addresses]

    @staticmethod
    def matches(match: str, values: list[str], keys: list[str]) -> bool:
        def one(value: str, key: str) -> bool:
            if match == ":is":
                return value.lower() == key.lower()
            if match == ":contains":
                return key.lower() in value.lower()
            if match == ":matches":
                glob = re.escape(key.lower()).replace(r"\*", ".*").replace(r"\?", ".")
                return re.fullmatch(glob, value.lower(), re.DOTALL) is not None
            return re.search(key.replace("[[:space:]]", r"[\s]"), value) is not None

        return any(one(value, key) for value in values for key in keys)


def deliver(script: str, message: Message) -> Delivery:
    """What `script` does with `message`: the mailbox it is filed into, or `KEEP`, and its flags."""

    return _Run(script, message).run()
