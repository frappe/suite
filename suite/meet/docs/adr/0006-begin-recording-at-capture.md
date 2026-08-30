# Begin a Recording Session at capture launch

A host request first creates a durable Recording Startup, visible only to hosts and co-hosts. The Recording Startup becomes a Recording Session only when the recorder durably records that FFmpeg launched; Frappe then uses the recorder launch timestamp as the session start and publishes the room-wide Recording Notice. Recorder acceptance was rejected because it includes uncaptured startup time, while the first durable media segment was rejected because the Recording Notice could lag capture by the 30-second segment interval.

## Consequences

- One Meet Recording record carries the Recording Startup and its resulting Recording Session.
- Frappe stores monotonic timestamps for recorder acceptance, Recording Grant delivery, proof completion, Meet Room join, and capture launch behind one host-facing `Starting` status.
- A Recording Startup has a 60-second overall deadline. Cancellation, expiration, or failure stops the Recorder Endpoint and produces no Recording Session or Recording Artifact.
- Cancelled and failed Recording Startups are retained for 30 days for idempotency and diagnosis.
- An expired Recording Grant fails the Recording Startup; Frappe does not issue a replacement because the current SFU Interface cannot prove that the previous grant was unconsumed.
- If the capture-start callback is lost, Frappe may begin the Recording Session from the recorder's durable launch timestamp during reconciliation. Without durable launch evidence, Frappe cancels the Recording Startup.
- Startup progress uses host/co-host-only realtime updates. Room-wide recording state and the Recording Notice begin with the Recording Session.
