import re
from email import message_from_string, policy
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr
from urllib.parse import unquote

from frappe.utils import cint, get_datetime_str
from frappe.utils.file_manager import save_file

from suite.mail.utils.dt import parsedate_to_datetime


class EmailParser:
    def __init__(self, message: str) -> None:
        self.message = self.get_parsed_message(message)
        self.cid_and_file_url_map = {}

    @staticmethod
    def get_parsed_message(message: str) -> Message:
        """Returns parsed email message object from string."""

        return message_from_string(message)

    def get_message_id(self) -> str | None:
        """Returns the message ID of the email."""

        if message_id := self.message.get("Message-ID"):
            return remove_whitespace_characters(message_id)

    def get_in_reply_to(self) -> str | None:
        """Returns the in-reply-to message ID of the email."""

        if in_reply_to := self.message.get("In-Reply-To"):
            return remove_whitespace_characters(in_reply_to)

    def get_subject(self) -> str | None:
        """Returns the decoded subject of the email."""

        if subject := self.message["Subject"]:
            decoded_subject = str(make_header(decode_header(subject)))
            return remove_whitespace_characters(decoded_subject)

        return None

    def get_sender(self) -> tuple[str, str]:
        """Returns the display name and email of the sender."""

        return parseaddr(str(make_header(decode_header(self.message["From"]))))

    def get_delivered_to(self) -> str | None:
        """Returns the Delivered-To email address of the email."""

        if delivered_to := self.message.get("Delivered-To"):
            return remove_whitespace_characters(delivered_to)

    def get_reply_to(self) -> str:
        """Returns the reply-to email(s) of the email."""

        if reply_to := self.message.get("Reply-To"):
            return remove_whitespace_characters(str(make_header(decode_header(reply_to))))

    def get_priority(self) -> int:
        """Returns the priority of the email."""

        return cint(self.get_header("X-Priority"))

    def get_header(self, header: str) -> str | None:
        """Returns the value of the header."""

        return self.message[header]

    def update_header(self, header: str, value: str) -> None:
        """Updates the value of the header."""

        if header in self.message:
            del self.message[header]

        self.message[header] = value

    def get_date(self) -> str | None:
        """Returns the date of the email."""

        if date_header := self.message.get("Date"):
            return get_datetime_str(parsedate_to_datetime(date_header))

    def get_size(self) -> int:
        """Returns the size of the email."""

        return len(self.message.as_string(policy=policy.default).encode("utf-8"))

    def get_recipients(self, types: str | list | None = None) -> list[dict]:
        """Returns the list of recipients of the email."""

        if not types:
            types = ["To", "Cc", "Bcc"]
        elif isinstance(types, str):
            types = [types]

        recipients = []
        for type in types:
            if addresses := self.message.get(type):
                for address in addresses.split(","):
                    display_name, email = parseaddr(remove_whitespace_characters(address))
                    if email:
                        recipients.append({"type": type, "email": email, "display_name": display_name})

        return recipients

    def save_attachments(self, doctype: str, docname: str, is_private: bool = True) -> None:
        """Saves the attachments of the email."""

        def save_attachment(
            filename: str, content: bytes, doctype: str, docname: str, is_private: bool
        ) -> dict:
            """Saves the attachment as a file."""

            kwargs = {
                "fname": filename,
                "content": content,
                "df": "file",
                "dt": doctype,
                "dn": docname,
                "is_private": cint(is_private),
            }
            file = save_file(**kwargs)
            return {
                "name": file.name,
                "file_name": file.file_name,
                "file_url": file.file_url,
                "is_private": file.is_private,
            }

        for part in self.message.walk():
            filename = part.get_filename()
            disposition = part.get("Content-Disposition")

            if disposition and filename:
                filename = unquote(filename)
                disposition = disposition.lower()

                if disposition.startswith("inline"):
                    if cid := re.sub(r"[<>]", "", part.get("Content-ID", "")):
                        if payload := part.get_payload(decode=True):
                            file = save_attachment(filename, payload, doctype, docname, is_private)
                            self.cid_and_file_url_map[cid] = file["file_url"]

                elif disposition.startswith("attachment"):
                    if payload := part.get_payload(decode=True):
                        save_attachment(filename, payload, doctype, docname, is_private)

    def get_body(self) -> tuple[str | None, str | None]:
        """Returns the HTML and plain text body of the email."""

        body_html, body_plain = "", ""

        for part in self.message.walk():
            content_type = part.get_content_type()

            if content_type == "text/html":
                if payload := part.get_payload(decode=True):
                    charset = part.get_content_charset() or "utf-8"
                    body_html += payload.decode(charset, "ignore")

            elif content_type == "text/plain":
                if payload := part.get_payload(decode=True):
                    charset = part.get_content_charset() or "utf-8"
                    body_plain += payload.decode(charset, "ignore")

        if self.cid_and_file_url_map:
            for cid, file_url in self.cid_and_file_url_map.items():
                body_html = body_html.replace(f"cid:{cid}", file_url)
                body_plain = body_plain.replace(f"cid:{cid}", file_url)

        return body_html or None, body_plain or None

    def get_authentication_results(self) -> dict[str, int | str]:
        """Returns the authentication results of the email."""

        result = {}
        checks = ["spf", "dkim", "dmarc"]

        for check in checks:
            result[f"{check}_pass"] = 0
            result[f"{check}_description"] = None

        # Only the topmost header is trusted. Each hop prepends its own, so headers[0] is the one
        # our receiving server wrote; anything below it came in with the message and is therefore
        # attacker-controlled. Reading all of them let a sender forge a "dkim=pass" of their own.
        if headers := self.message.get_all("Authentication-Results"):
            for segment in headers[0].split(";"):
                segment = remove_whitespace_characters(segment)
                segment_lower = segment.lower()

                for check in checks:
                    if f"{check}=" in segment_lower:
                        result[f"{check}_pass"] = 1 if f"{check}=pass" in segment_lower else 0
                        result[f"{check}_description"] = segment
                        break

        return result

    def get_message(self) -> str:
        """Returns the email message as a string."""

        return self.message.as_string()


def remove_whitespace_characters(text: str) -> str:
    """Removes whitespace characters from the text."""

    return text.replace("\t", "").replace("\r", "").replace("\n", "").strip()


ENCODED_WORD = re.compile(r"=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=")
# Whitespace between two encoded-words belongs to the encoding, not to the text (RFC 2047, §6.2).
ENCODED_WORD_SEPARATOR = re.compile(r"(\?=)\s+(=\?)")


def decode_encoded_words(text: str | None) -> str | None:
    """Decodes any RFC 2047 encoded-words in the text, leaving the rest of it untouched.

    Display names arrive decoded from the mail server, except where the sending client put an
    encoded-word inside a quoted string — which RFC 2047 does not allow, so a strict parser
    leaves it alone and `"Jungeun Yun/=?UTF-8?B?...?="` reaches us verbatim.

    Decoding a word at a time rather than through `make_header`, which separates the pieces it
    decodes with a space and would break that same name into two.
    """

    if not text or "=?" not in text:
        return text

    return ENCODED_WORD.sub(_decode_word, ENCODED_WORD_SEPARATOR.sub(r"\1\2", text))


def _decode_word(match: re.Match) -> str:
    """Decodes a single encoded-word, keeping it as it is if that isn't possible."""

    word = match.group(0)

    try:
        text, charset = decode_header(word)[0]
    except Exception:
        return word

    if not isinstance(text, bytes):
        return text

    try:
        return text.decode(charset or "utf-8", errors="replace")
    except LookupError:
        # A charset the sender named and Python doesn't know.
        return text.decode("utf-8", errors="replace")


def extract_ip_and_host(header: str | None = None) -> tuple[str | None, str | None]:
    """Extracts the IP and Host from the given `Received` header."""

    if not header:
        return None, None

    ip_pattern = re.compile(r"\[(?P<ip>[\d\.]+|[a-fA-F0-9:]+)")
    host_pattern = re.compile(r"from\s+(?P<host>[^\s]+)")

    ip_match = ip_pattern.search(header)
    ip = ip_match.group("ip") if ip_match else None

    host_match = host_pattern.search(header)
    host = host_match.group("host") if host_match else None

    return ip, host


def extract_spam_status(header: str | None = None) -> tuple[bool, float]:
    """
    Extracts the spam status and score from the given `X-Spam-Status` header.

    Args:
        header (str | None): The `X-Spam-Status` header.

    Returns:
        Tuple[bool, float]: A tuple containing the spam status (True for "Yes", False otherwise) and the spam score.
    """

    if not header:
        return False, 0.0

    status_pattern = re.compile(r"^\s*(Yes|No)", re.IGNORECASE)
    score_pattern = re.compile(r"score=(-?\d+\.?\d*)")

    status_match = status_pattern.search(header)
    score_match = score_pattern.search(header)

    status = status_match.group(1).lower() == "yes" if status_match else False
    score = float(score_match.group(1)) if score_match else 0.0

    return status, score
