# Shard large Meet Rooms across mediasoup routers

A large Meet Room may place Participant Connections across multiple mediasoup routers on distinct workers within one SFU process. Each Participant Connection has one immutable home router for its lifetime, while the room keeps one primary router for room-wide media functions such as active-speaker observation and speech-to-text ingestion.

Rooms start with one router. Once its configured Participant Connection budget is reached, the next connection activates the next configured worker and is placed there. This fill-and-spill policy preserves the single-router path for ordinary rooms and reserves CPU headroom because existing shards gain relay work as later shards activate. The budget is an operational guardrail, not an admission limit; the final configured shard accepts overflow.

The SFU preserves the origin Producer ID as the canonical signaling identity. It uses `pipeToRouter` with `keepId: true`, so existing producer and consumer signaling remains topology-blind. Audio is piped to every active shard and newly activated shards receive existing audio. This supports normal audio subscription, the primary active-speaker observer, and primary-router speech-to-text ingestion. Video is piped only when a participant on another shard requests a Consumer. Cross-router video representations are reference-counted and close after their final endpoint Consumer closes.

This follows the common shape used by established SFU systems: mediasoup assigns routers to individual workers and exposes explicit router piping; LiveKit keeps a room local to one node and performs load-aware whole-room placement; Jitsi Octo cascades media only when a conference spans bridges and combines this with receiver-driven source selection. Meet therefore keeps small rooms local, activates additional media workers only when needed, and avoids eager camera fan-out.

## Consequences

- Router sharding is opt-in and defaults to one router per Meet Room until correctness and capacity tests pass.
- A room may use at most one router per worker; configuration fails when the requested shard count exceeds the worker count.
- Participant Connections fill one router up to `MEDIASOUP_PEERS_PER_ROUTER`, then spill to the next router, and never migrate while connected.
- WebRTC transports always use the home router and that worker's WebRTC server.
- Audio Producers are available on the primary router so active-speaker observation and speech-to-text keep one authoritative room view.
- Audio Producer publication waits for required pipes. Partial pipe failure closes the origin Producer and every pipe representation created for it.
- A cross-router video pipe is created by `create_consumer`, shared by Consumers on the same destination router, and removed when its reference count reaches zero.
- Closing an origin Producer closes its pipe representations and endpoint Consumers exactly once.
- Router IDs, worker IDs, and pipe Producer objects remain internal and never enter participant or recording contracts.
- Worker death retains the existing process-fatal behavior; shard recovery and live migration are separate decisions.
- Prometheus reports active Routers, sharded rooms, pipe representations, and cross-Router video endpoint references as process-wide resource aggregates. Alerts must avoid per-room labels and should watch for pipe growth that does not return to baseline after rooms close.
- `MEDIASOUP_PEERS_PER_ROUTER` starts at 13 based on the current 18-participant conservative single-router result, leaving relay headroom. It must be tuned with distributed 50-participant benchmarks using 30-40 active cameras and microphones before enabling multiple routers in production.
