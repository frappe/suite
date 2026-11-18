# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The header layer as Sieve, so the mail server gives a message its category as it delivers it.

A category given on first fetch is missing from mail no site has fetched yet, and an Inbox tab,
which lists by keyword, then shows too little. The server knows the headers at delivery, so the
account's automation script carries the header layer's rules and adds the keyword there.

The rules are `headers._RULES`, in that order, built from the constants the Python rules read. Only
what a rule claims is marked: mail no rule claims is left without a keyword, for the layers that
cannot run on the mail server.

Written for Stalwart. Its `:regex` compares case as written, whatever the comparator, so each
pattern carries `(?i)`. A pattern holds no backslash other than an escaped quote: the server's
parser misreads the rest (see `sieve_script._escape_sieve_string`).

Where the Sieve differs from the Python rule: a header sent twice matches on either copy, where
Python reads the last, and a From with several addresses matches on any, where Python reads the
first.
"""

import re
from collections.abc import Callable, Iterable

from suite.mail.classification import headers
from suite.mail.classification.category import Category

BLOCK_NAME = "Category"

# The separators `_Headers.sender` drops from a sender's name, as a bracket expression.
_SEPARATORS = "[-_.]*"
_SPACE = "[[:space:]]*"

# What a constant may hold to mean itself: in a pattern, and in a quoted string.
_LITERAL = re.compile(r"[a-z0-9/-]+")
_QUOTABLE = re.compile(r"[a-z0-9/.*-]+")


def _literal(text: str, allowed: re.Pattern = _LITERAL) -> str:
    """`text`, refused if writing it into the script as it is would change what it means."""

    if not allowed.fullmatch(text):
        raise ValueError(f"{text!r} cannot be written into the classification Sieve as it is.")
    return text


def _strings(values: Iterable[str]) -> str:
    return "[" + ", ".join(f'"{_literal(value, _QUOTABLE)}"' for value in sorted(values)) + "]"


def _alternatives(values: Iterable[str]) -> str:
    return "(" + "|".join(_literal(value) for value in sorted(values)) + ")"


def _has(*names: str) -> str:
    """A test for any of the headers. `exists` with a list asks for all of them (RFC 5228 §5.5)."""

    tests = [f'exists "{_literal(name)}"' for name in sorted(names)]
    return tests[0] if len(tests) == 1 else _any(*tests)


def _value(name: str, pattern: str) -> str:
    """A test of a header's value, as `_Headers.value` gives it: less any `; parameters`."""

    return f'header :regex "{_literal(name)}" "(?i)^{_SPACE}{pattern}"'


def _value_is(name: str, *values: str) -> str:
    return _value(name, f"{_alternatives(values)}{_SPACE}(;|$)")


def _parameter_is(name: str, parameter: str, values: Iterable[str]) -> str:
    pattern = f'{_literal(parameter)}{_SPACE}={_SPACE}\\"?{_alternatives(values)}\\"?{_SPACE}(;|$)'
    return f'header :regex "{_literal(name)}" "(?i);{_SPACE}{pattern}"'


def _sender(names: Iterable[str], whole: bool = True) -> str:
    """A test of the sender's name as `_Headers.sender` spells it: any case, separators anywhere,
    and a +tag after it. `whole` for the name itself, otherwise for a name that starts with one."""

    spelled = "|".join(_SEPARATORS.join(_literal(name)) for name in sorted(names))
    end = f"{_SEPARATORS}([+].*)?$" if whole else ""
    return f'address :localpart :regex "from" "(?i)^{_SEPARATORS}({spelled}){end}"'


def _any(*tests: str) -> str:
    return "anyof (" + ", ".join(tests) + ")"


def _all(*tests: str) -> str:
    return "allof (" + ", ".join(tests) + ")"


# Each rule of the header layer, as the Sieve test that matches the same mail.
_TESTS: dict[Callable, str] = {
    headers._reports_on_sent_mail: _all(
        _value_is("content-type", "multipart/report"),
        _parameter_is("content-type", "report-type", headers.REPORTS_ON_SENT_MAIL),
    ),
    headers._from_social_network: 'address :domain :matches "from" '
    + _strings(pattern for domain in headers.SOCIAL_DOMAINS for pattern in (domain, f"*.{domain}")),
    headers._from_discussion_list: _all(
        f"not {_value('list-post', 'no')}",
        _any(
            _has("list-post", *headers.DISCUSSION_LIST_HEADERS),
            _all(_has("list-id"), _value_is("precedence", "list")),
        ),
    ),
    headers._sent_by_campaign_tool: _any(
        _has(*headers.MARKETING_HEADERS), _value("x-mailer", "[^;]*mailchimp")
    ),
    headers._generated_by_a_system: _value_is("auto-submitted", "auto-generated", "auto-notified"),
    headers._from_transactional_sender: _sender(headers.TRANSACTIONAL_SENDERS),
    headers._subscribed_to: _any(_has("list-unsubscribe", "list-id"), _sender(headers.MARKETING_SENDERS)),
    headers._from_automated_sender: _any(
        _sender(headers.AUTOMATED_SENDER_PREFIXES, whole=False), _value_is("precedence", "bulk", "junk")
    ),
}


def _branch(opener: str, category: Category, test: str) -> list[str]:
    return [f"{opener} {test} {{", f'  addflag "{category.keyword}";', "}"]


def build_classification_block() -> str:
    """The Sieve block that adds its category keyword to mail a rule of the header layer claims.

    One `if`/`elsif` chain, so the first rule to match wins as it does in `classify_by_headers`.
    It only adds a flag: where the message goes is left to the blocks after it, whose `fileinto`
    and `keep` carry the flag along (RFC 5232). A rule without a Sieve test fails the build.
    """

    lines = [f"# {BLOCK_NAME}"]
    for index, (category, matches) in enumerate(headers._RULES):
        lines += _branch("elsif" if index else "if", category, _TESTS[matches])

    return "\n".join(lines) + "\n"
