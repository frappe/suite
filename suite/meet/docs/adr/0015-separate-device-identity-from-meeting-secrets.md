# Separate device identity from meeting secrets

Meet persists two Ed25519 key pairs for a device. The authentication key identifies the device to the site when a host enables end-to-end encryption. The frame-signing key authenticates media to other participants. Those participants receive the signing public key through the meeting key exchange. Keeping these roles separate lets the site verify device identity while frame authentication remains between participants.

Browser IndexedDB stores the private device keys as non-extractable CryptoKeys. The browser migrates older private JWK entries on read. Meeting secrets and ephemeral agreement keys stay in memory. After leaving or reloading, the browser establishes its meeting state through a fresh exchange.

The main-thread transform and the worker share the frame codec so the wire format and key derivations stay consistent. Their replay windows differ deliberately. The main thread uses a short window to limit work on the realtime path, while the worker has room for a larger window.

A transport reconnect can replay retained commits and welcomes against the browser's in-memory meeting state. A page departure clears that state. The SFU persists roster membership only. It prefers an online host to author an epoch commit, can reassign a timed-out request, and batches simultaneous joiners into one request. File-backed roster storage is single-process and replaces the file atomically.
