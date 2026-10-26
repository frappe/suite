# Shared default camera evidence

Run from the repository root after installing root, frontend, SFU, and e2e dependencies:

```sh
MEDIASOUP_WORKER_BIN=/path/to/compatible/mediasoup-worker \
  node e2e/meet/shared-view/run.mjs
```

The worker override is optional when the packaged worker runs on the host CPU.
Output defaults to `/tmp/meet-shared-view-proof`; override with
`SHARED_VIEW_EVIDENCE_DIR`. No Frappe database or Redis is required.

This starts a real isolated SFU and two independent receiver browsers inside a
side-by-side dashboard. It runs production MeetingLayout, ParticipantConnection,
SFUMeetingManager, the participant Pinia store, media/transport managers, and
VideoElementManager. Only presentation tiles, context, session, and utility CSS
are fixtures; synthetic moving canvas cameras and oscillator audio are real
WebRTC publications. The screen tile is explicitly a presentation placeholder;
its real eager Consumer and RTP statistics are still checked.

R1 observes actual SFU audio activity D then C. Both stop before R2 joins, so R2
never receives those raw speaker events. Both must nevertheless select C from
the current canonical snapshot. Further phases check sustained B, R1's personal
pin D, unpin back to B, R2 reconnecting, and silence retaining recent B.

Every settled window checks independently expected camera participant/Producer
IDs, exact canonical state equality, advancing inbound bytes and decoded frames,
visible camera attachment, unchanged eager audio/screen subscriptions, and SFU
resource gauges. Teardown checks zero Producers and Consumers. `result.json`
contains raw before/after WebRTC stats, canonical update history, source hashes,
worker hash, and timestamps. `shared-view.webm` and numbered PNGs show the actual
moving streams and diagnostics.

Negative control:

```sh
SHARED_VIEW_NEGATIVE_CONTROL=1 \
SHARED_VIEW_EVIDENCE_DIR=/tmp/meet-shared-view-negative \
MEDIASOUP_WORKER_BIN=/path/to/compatible/mediasoup-worker \
  node e2e/meet/shared-view/run.mjs
```

This drops canonical delivery only on R2 while leaving its real signaling,
layout and receive stack running. It must fail the late-join expectation: local
raw speaker history cannot reconstruct the missed conversation.

The invariant is shared **room ranking before self exclusion**. Each endpoint
filters that ranking through its eligible remote inventory and then applies
personal pins and viewport capacity. With equal inventory/settings/capacity and
a reconciled canonical version, ordered defaults match. Different capacities
select prefixes; self remains a local tile and never creates a remote self
Consumer. The real browser recording covers equal viewports and nonpublishing
receivers; focused layout/media tests cover capacity prefixes and self exclusion.
This is correctness evidence for those scenarios, not a capacity benchmark or a
claim that clients render the same pixels during network/event transitions.
