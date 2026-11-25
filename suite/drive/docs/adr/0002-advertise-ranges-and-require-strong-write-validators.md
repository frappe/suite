# Advertise byte ranges and require strong write validators in WebDAV

Drive publishes `Accept-Ranges: bytes` on WebDAV file responses. Werkzeug adds it for partial responses, so Drive fills it in on other responses. Clients can discover support before requesting a range.

WebDAV uses strong validators for `If-Match` write preconditions. Weak validators can match for cache revalidation, but they cannot establish that the representation is unchanged for a write. See RFC 7232 §2.3.2.
