# Use one active Participant Connection per participant

An authenticated participant has at most one active Participant Connection in a Meet Room. The client supplies a stable connection ID for signaling reconnects; the authenticated socket identity remains authoritative. A different device must confirm takeover using an opaque conflict ID tied to the current ownership generation.

## Consequences

- A signaling reconnect with the same connection ID replaces the stale socket automatically.
- A different connection first receives a structured conflict and cannot disrupt the incumbent.
- Confirmed takeover atomically changes ownership, notifies and disconnects the exact old socket, and does not create participant-left/joined presence churn.
- Ownership generations guard cleanup so stale sockets and stale confirmations cannot release or successively evict newer owners.
- Mediasoup peer IDs remain socket-specific; recorder and presence-preview connections are outside this ownership rule.
