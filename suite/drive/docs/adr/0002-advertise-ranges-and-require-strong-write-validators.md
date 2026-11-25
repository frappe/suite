# Advertise byte ranges and require strong write validators in WebDAV

Drive publishes `Accept-Ranges: bytes` on WebDAV file responses. Werkzeug adds it for partial responses, so Drive fills it in on other responses. Clients can discover support before requesting a range.

WebDAV uses strong validators for `If-Match` write preconditions. Weak validators can match for cache revalidation, but they cannot establish that the representation is unchanged for a write. See RFC 7232 §2.3.2.

A matching `If-Match` takes precedence over `If-Unmodified-Since`, as specified by RFC 7232 §6. Once the client provides a matching strong validator, a stale timestamp does not cause a 412.

WebDAV uses the node's content modification time for both `Last-Modified` and `getlastmodified`. Werkzeug can derive the header from the blob's filesystem timestamp, which reflects when the bytes were stored and can be shared by several nodes. The node timestamp keeps the two WebDAV responses consistent.

WebDAV adds the download and active-content headers to responses carrying file content. A 304 leaves those headers alone because a cache can use response headers to update the stored representation's metadata. The byte route performs one READ check. A node outside the caller's read access returns 404, keeping it indistinguishable from a missing node.
