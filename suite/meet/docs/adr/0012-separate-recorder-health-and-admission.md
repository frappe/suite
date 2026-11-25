# Separate recorder health from Recording Startup admission

Frappe treats Meet Media Deployment configuration, cached Recorder Readiness, advisory Recording Capacity, and authoritative Recording Startup admission as distinct facts. Periodic authenticated probes update a short-lived health record for preflight and operations, while only the recorder's reservation response decides admission; synchronous participant-request health calls and queued recording requests were rejected because they add latency without removing races.

## Consequences

- The recorder exposes an authenticated deployment-health response with observation time, readiness, typed readiness reason, configured capacity, active count, and advisory available count.
- Frappe records health with a bounded freshness period. Missing configuration is a hard preflight failure; stale, unready, or zero-capacity observations are advisory and do not disable an authorized reservation attempt.
- Preflight reports policy eligibility separately from deployment health. It does not present cached capacity as a reservation guarantee.
- Reservation remains immediate and unqueued. Capacity, recorder storage, readiness, recovery state, policy, and invalid-request rejections use distinct typed reason codes from ADR-0009.
- The Frappe recorder Adapter preserves typed outcomes. Participant presentation maps safe reason codes to specific messages while retaining generic treatment for invalid or security-sensitive requests.
- Tests cover stale probes, configured-but-unready deployment, capacity races in both directions, disk admission, recovery-required state, typed presentation, and the invariant that no result queues a Recording Startup.

The recorder claims capacity before initializing a worker so simultaneous reservations cannot overbook it. On the site, reconciliation skips Pending and Stopping work when the recorder is unconfigured. The stale sweep can still fail those sessions as recorder-unavailable after their deadline.

A recording's storage reservation stays charged to its original Personal root, including after that root is archived. Capture planning allows for up to three full segments in flight during a stop because segment adoption depends on its successor and must pass validation before callback shutdown.
