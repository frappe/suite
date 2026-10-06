# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Layer 1: what a message's headers say about how it was sent.

Headers tell bulk and automated mail from mail a person wrote, and a discussion list from a
campaign. They do not read the message, so mail without any such header is passed on rather than
guessed at.
"""

from collections.abc import Callable

from suite.mail.classification.category import Category

# Social networks notify from their own domains, or a subdomain of them.
SOCIAL_DOMAINS = frozenset(
    {
        "bsky.app",
        "discord.com",
        "facebook.com",
        "facebookmail.com",
        "instagram.com",
        "linkedin.com",
        "mastodon.social",
        "medium.com",
        "meetup.com",
        "nextdoor.com",
        "pinterest.com",
        "quora.com",
        "reddit.com",
        "redditmail.com",
        "snapchat.com",
        "strava.com",
        "telegram.org",
        "threads.net",
        "tiktok.com",
        "tumblr.com",
        "twitch.tv",
        "twitter.com",
        "vk.com",
        "whatsapp.com",
        "x.com",
        "youtube.com",
    }
)

# Headers only a mailing list manager adds: Mailman, ezmlm and Google Groups.
DISCUSSION_LIST_HEADERS = ("mailing-list", "x-mailman-version", "x-google-group-id")

# Headers only a campaign tool adds: Mailchimp, Salesforce Marketing Cloud, Klaviyo, Brevo,
# Constant Contact and Marketo. Providers that also carry receipts and password resets
# (SendGrid, SES, Mailgun, Postmark) say nothing about which of the two a message is.
MARKETING_HEADERS = (
    "x-mc-user",
    "x-campaign",
    "x-campaignid",
    "x-campaign-id",
    "x-sfmc-stack",
    "x-kmail-account",
    "x-mailin-campaign",
    "x-roving-id",
    "x-marketoid",
)

# Sender names, as `_Headers.sender` spells them: lowercased, without separators or a +tag.
MARKETING_SENDERS = frozenset(
    {"newsletter", "newsletters", "news", "marketing", "promo", "promos", "promotions", "offers", "deals"}
)
TRANSACTIONAL_SENDERS = frozenset(
    {
        "alert",
        "alerts",
        "billing",
        "invoice",
        "invoices",
        "notification",
        "notifications",
        "notify",
        "order",
        "orders",
        "payments",
        "receipt",
        "receipts",
        "security",
    }
)
AUTOMATED_SENDER_PREFIXES = ("noreply", "donotreply")


class _Headers:
    """A message's headers, by lowercased name.

    The JMAP `headers` property gives each value raw - folded across lines, in whatever case it
    was sent - so values are unfolded and lowercased here.
    """

    def __init__(self, email: dict) -> None:
        self._values: dict[str, str] = {}
        for header in email.get("headers") or []:
            # The last occurrence wins, as it does for a JMAP `header:` property.
            self._values[(header.get("name") or "").lower()] = " ".join(
                (header.get("value") or "").lower().split()
            )

        address = ((email.get("from") or [{}])[0].get("email") or "").lower()
        local, _, self.sender_domain = address.rpartition("@")
        # "No-Reply+abc" and "no_reply" are the same sender as "noreply".
        self.sender = local.partition("+")[0].translate(str.maketrans("", "", "-_."))

    def has(self, *names: str) -> bool:
        return any(name in self._values for name in names)

    def value(self, name: str) -> str:
        """The header's value, less any `; parameters`. Empty when the header is absent."""

        return self._values.get(name, "").partition(";")[0].strip()


def _from_social_network(headers: _Headers) -> bool:
    domain = headers.sender_domain
    return any(domain == social or domain.endswith(f".{social}") for social in SOCIAL_DOMAINS)


def _from_discussion_list(headers: _Headers) -> bool:
    # RFC 2369 §3.4: "List-Post: NO" is a list nobody may post to - announcements, not discussion.
    if headers.value("list-post").startswith("no"):
        return False

    return (
        headers.has("list-post", *DISCUSSION_LIST_HEADERS)
        # A campaign has a List-Id too, but goes out as "bulk".
        or (headers.has("list-id") and headers.value("precedence") == "list")
    )


def _sent_by_campaign_tool(headers: _Headers) -> bool:
    return headers.has(*MARKETING_HEADERS) or "mailchimp" in headers.value("x-mailer")


def _generated_by_a_system(headers: _Headers) -> bool:
    # RFC 3834. "auto-replied" is left out on purpose: a vacation reply or a bounce answers
    # something the user sent, and belongs with the conversation it is part of.
    return headers.value("auto-submitted") in ("auto-generated", "auto-notified")


def _from_transactional_sender(headers: _Headers) -> bool:
    return headers.sender in TRANSACTIONAL_SENDERS


def _subscribed_to(headers: _Headers) -> bool:
    # A message that can be unsubscribed from is one of many sent to a list of subscribers.
    return headers.has("list-unsubscribe", "list-id") or headers.sender in MARKETING_SENDERS


def _from_automated_sender(headers: _Headers) -> bool:
    return headers.sender.startswith(AUTOMATED_SENDER_PREFIXES) or headers.value("precedence") in (
        "bulk",
        "junk",
    )


# First match wins, so the order is the argument:
# - a social network's mail carries list and bulk headers too, so who sent it is asked first;
# - a discussion list can be unsubscribed from like a campaign, so it is told apart before one;
# - a campaign tool marks a promotion however automated the rest of the message looks;
# - a system notice or a billing address is an update even when it offers an unsubscribe link,
#   while a bare "noreply" is an update only when nothing says the mail was subscribed to.
_RULES: tuple[tuple[Category, Callable[[_Headers], bool]], ...] = (
    (Category.SOCIAL, _from_social_network),
    (Category.FORUMS, _from_discussion_list),
    (Category.PROMOTIONS, _sent_by_campaign_tool),
    (Category.UPDATES, _generated_by_a_system),
    (Category.UPDATES, _from_transactional_sender),
    (Category.PROMOTIONS, _subscribed_to),
    (Category.UPDATES, _from_automated_sender),
)


def classify_by_headers(email: dict) -> Category | None:
    """The category the headers of `email` (an Email as fetched, with `headers` and `from`) put it
    in, or None when they do not say."""

    headers = _Headers(email)
    return next((category for category, matches in _RULES if matches(headers)), None)
