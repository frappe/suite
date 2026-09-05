# Drive implementation tickets

Created: 2026-09-05. Implementation has not started.

37 local tickets: 31 agent-ready implementation tickets and six gated follow-ups.
`ready-for-agent` describes triage. Blocking edges and execution gates still apply.

## Sources

- [Accepted spec](../../wayfinder/drive-layer-spec/drive-layer-spec.md): behavior.
- [Accepted decision review](../../wayfinder/drive-layer-spec/decision-review.md): the twelve resolved choices.
- [Implementation plan](../../wayfinder/drive-layer-spec/drive-layer-plan.md): repository scope, ownership, and test commands.
- [Architecture charter](../../ARCHITECTURE.md): module placement and dependency boundaries.
- [Drive glossary](../../suite/drive/CONTEXT.md): domain terms.

The spec wins for behavior. The charter wins for module boundaries.
The ticket graph refines the plan's stages into smaller verified outcomes.
Historical design tickets remain unchanged. This backlog contains implementation work.

## Execution rules

### Start and choose work

1. Start only when implementation execution is authorized. Creating this backlog does not start an AFK run.
2. Read this guide and the chosen ticket's source sections. Check applicable repository instructions.
3. Verify the current branches and preserve existing work. Checkpoint accepted inputs before branching for implementation.
4. Suite implementation uses `forge/drive-layer`, based on `forge/wayfinder-drive-layer`.
5. Framework implementation uses the existing `forge/storage-v2` branch in the adjacent Frappe repository.
6. Choose the lowest-numbered `ready-for-agent` ticket whose blockers are `done` and whose execution gate is satisfied.
7. Mark it `in-progress`, with owner, starting revisions, and claimed files. One owner may edit a file at a time.
8. Implement the complete ticket, run its checks, and record actual completion evidence.
9. The orchestrator commits verified changes. Workflow agents do not commit. Record both repositories' revisions when applicable.
10. Set `done` only after every acceptance criterion passes. Then select the next unblocked ticket.

Unblocked initial tickets: architecture boundaries, GC reference discovery, trusted uploads, and blob egress.
Default execution is serial. Graph independence does not authorize simultaneous edits or shared-site tests.
No runner, scheduler, or `/implement-spec` installation is created by these documents.

### Integration and verification

This is a wide replacement using expand, migrate, then contract.
New workflows stay beside legacy paths until their replacement and migration tests pass.
A ticket is independently verifiable through its workflow or adapter tests; it is not necessarily independently deployable.
The complete backend release checkpoint is [backend integration review](issues/30-backend-integration-review.md).

- Keep legacy source fields and rows readable until Build copies them and Cleanup permits removal.
- Stage content registry activation and permission-hook changes after required node links exist.
- A partial Build or Cleanup implementation must not run from ordinary migration registration.
- Use real workflow tests for policy. Use adapter tests for HTTP, DAV, and Frappe translation.
- Use isolated fixtures for purge, Cleanup, and storage-deletion tests. Never use live user rows as test fixtures.
- Run shared bench tests serially on `slides.localhost`. Use the commands in the implementation plan.
- Run narrow checks after each ticket. Run broader integration checks at the stated integration ticket.
- Record performance against actual MariaDB queries and selected columns. Historical timings are reference budgets only.
- Follow the plan's file ownership. Serialize shared entrypoints, registry wiring, hooks, and migration registration.

### Stop conditions

- Work only in the Suite and specified Frappe repositories, using the authorized bench and test site.
- Do not push, create PRs, publish services, restart services, or install dependencies as part of this run.
- Keep existing data and unrelated work intact. A real dataset restore requires the rehearsal ticket's explicit target authority.
- Do not change an accepted behavior to make a failing test pass.
- Resolve routine implementation choices within the spec. Record contradictory requirements or missing product decisions as blockers.
- If a check cannot run, record the missing tool, fixture, access, or environment. Do not mark it verified.
- For a blocked ticket, record the reason and continue with another eligible independent ticket.
- When no eligible ticket remains, report the completed work and remaining gates. Do not bypass a gate to stay busy.

### Evidence per ticket

Record the changed behavior, affected interfaces, exact revisions, commands, and real results.
Include failure/rollback evidence when the workflow changes persistent state.
Record required measurements and remaining risks. Keep acceptance boxes unchecked until proved.

## Release gates

| Work | Gate |
|---|---|
| Backend implementation and isolated tests | Completed blocking tickets; existing execution scope |
| Real migration rehearsal | Approved export, selected target, backup, and authority to overwrite that target |
| Frontend adoption | Separate implementation scope; these tickets capture dependencies without starting that effort |
| Cleanup preparation | Fixture tests only; patch stays inactive |
| Cleanup activation | A release after Build, migrated clients, all runtime gates, backup, and destructive-deployment authority |
| Actual blob relocation | Verified Build, configured destination, and relocation/source-deletion authority |

Frontend adoption does not block backend implementation. It does block Cleanup.
Framework relocation implementation and its later execution do not block Build or Cleanup.
Frappe Cloud allowlisting remains an external prerequisite if the eventual deployment target needs it.

## Ticket index

Numbers follow dependency order. Follow the linked blocking edges, not a requirement to finish every earlier number.

| Ticket | Owner | Blocked by | Initial status |
|---|---|---|---|
| [01 — Freeze the Drive interface and enforce product boundaries](issues/01-architecture-boundaries.md) | Suite architecture | None | ready-for-agent |
| [02 — Keep every referenced blob alive during garbage collection](issues/02-blob-reference-gc.md) | Frappe storage | None | ready-for-agent |
| [03 — Finish trusted upload sessions without creating a File](issues/03-trusted-blob-upload.md) | Frappe storage | None | ready-for-agent |
| [04 — Serve authorized blobs with signed URLs and byte ranges](issues/04-blob-egress.md) | Frappe storage | None | ready-for-agent |
| [05 — Preserve File adoption hooks on storage v2 uploads](issues/05-file-upload-hook.md) | Frappe storage | [03](issues/03-trusted-blob-upload.md) | ready-for-agent |
| [06 — Implement resumable blob relocation](issues/06-relocation-implementation.md) | Frappe storage | [02](issues/02-blob-reference-gc.md) | ready-for-agent |
| [07 — Create root pairs and resolve node access](issues/07-root-pairs-and-access.md) | Suite Drive engine | [01](issues/01-architecture-boundaries.md), [02](issues/02-blob-reference-gc.md), [03](issues/03-trusted-blob-upload.md), [04](issues/04-blob-egress.md) | ready-for-agent |
| [08 — Manage grants and share links with explicit denial](issues/08-grant-and-link-workflows.md) | Suite Drive engine | [07](issues/07-root-pairs-and-access.md) | ready-for-agent |
| [09 — Browse permission-filtered trees and measure indexes](issues/09-listings-and-index-measurement.md) | Suite Drive engine | [08](issues/08-grant-and-link-workflows.md) | ready-for-agent |
| [10 — Upload and replace files under Drive authority and quota](issues/10-upload-and-quota.md) | Suite Drive node workflows | [09](issues/09-listings-and-index-measurement.md) | ready-for-agent |
| [11 — Move, copy, trash, and explicitly restore node trees](issues/11-node-lifecycle.md) | Suite Drive node workflows | [10](issues/10-upload-and-quota.md) | ready-for-agent |
| [12 — Keep and restore versions with bounded automatic history](issues/12-version-history.md) | Suite Drive versions | [11](issues/11-node-lifecycle.md) | ready-for-agent |
| [13 — Show reusable previews without charging users](issues/13-preview-lifecycle.md) | Suite Drive previews | [10](issues/10-upload-and-quota.md) | ready-for-agent |
| [14 — Keep comments, history, and personal lists on nodes](issues/14-comments-and-records.md) | Suite Drive record workflows | [11](issues/11-node-lifecycle.md) | ready-for-agent |
| [15 — Archive roots and charge Meet reservations to roots](issues/15-root-administration-and-meet.md) | Suite Drive and Meet | [11](issues/11-node-lifecycle.md) | ready-for-agent |
| [16 — Create content documents and media through one Drive contract](issues/16-content-contract.md) | Suite Drive content contract | [12](issues/12-version-history.md), [13](issues/13-preview-lifecycle.md), [14](issues/14-comments-and-records.md), [15](issues/15-root-administration-and-meet.md) | ready-for-agent |
| [17 — Move Writer lifecycle and history into Drive](issues/17-writer-adoption.md) | Suite Writer | [16](issues/16-content-contract.md) | ready-for-agent |
| [18 — Move Slides documents and media into Drive](issues/18-slides-adoption.md) | Suite Slides | [16](issues/16-content-contract.md) | ready-for-agent |
| [19 — Move Sheets lifecycle and collaboration checks into Drive](issues/19-sheets-adoption-and-collab.md) | Suite Sheets | [16](issues/16-content-contract.md) | ready-for-agent |
| [20 — Load composite references in authorized groups](issues/20-composite-group-contract.md) | Suite Slides API | [18](issues/18-slides-adoption.md) | ready-for-agent |
| [21 — Expose node, upload, and root workflows through HTTP](issues/21-http-node-workflows.md) | Suite Drive HTTP | [17](issues/17-writer-adoption.md), [19](issues/19-sheets-adoption-and-collab.md), [20](issues/20-composite-group-contract.md) | ready-for-agent |
| [22 — Expose sharing, views, history, and comments through HTTP](issues/22-http-sharing-and-records.md) | Suite Drive HTTP | [21](issues/21-http-node-workflows.md) | ready-for-agent |
| [23 — Keep legacy callers working through the new Drive workflows](issues/23-legacy-compatibility.md) | Suite Drive HTTP compatibility | [22](issues/22-http-sharing-and-records.md) | ready-for-agent |
| [24 — Browse and download ordinary files over WebDAV](issues/24-webdav-read.md) | Suite Drive WebDAV | [23](issues/23-legacy-compatibility.md) | ready-for-agent |
| [25 — Write and lock files over the same Drive workflows](issues/25-webdav-write.md) | Suite Drive WebDAV | [24](issues/24-webdav-read.md) | ready-for-agent |
| [26 — Prepare legacy bytes for an additive Build](issues/26-build-storage-preparation.md) | Suite migration | [25](issues/25-webdav-write.md) | ready-for-agent |
| [27 — Migrate root pairs, node trees, and grants](issues/27-build-tree-and-grants.md) | Suite migration | [26](issues/26-build-storage-preparation.md) | ready-for-agent |
| [28 — Migrate content history, comments, templates, and media](issues/28-build-content-and-media.md) | Suite migration and content adapters | [27](issues/27-build-tree-and-grants.md) | ready-for-agent |
| [29 — Complete Build records, accounting, and reporting](issues/29-build-records-and-report.md) | Suite migration | [28](issues/28-build-content-and-media.md) | ready-for-agent |
| [30 — Verify the complete backend before migration rehearsal](issues/30-backend-integration-review.md) | Suite integration | [05](issues/05-file-upload-hook.md), [29](issues/29-build-records-and-report.md) | ready-for-agent |
| [31 — Rehearse Build on an approved export and verify rollback](issues/31-migration-rehearsal.md) | Suite migration operations | [30](issues/30-backend-integration-review.md) | blocked |
| [32 — Adopt Drive routes and explicit restore selection in the SPA](issues/32-frontend-drive-adoption.md) | Suite frontend Drive | [30](issues/30-backend-integration-review.md) | ready-for-human |
| [33 — Make sharing actions and relevant link credentials explicit](issues/33-frontend-sharing-and-links.md) | Suite frontend Drive sharing | [32](issues/32-frontend-drive-adoption.md) | ready-for-human |
| [34 — Adopt document media, grouped composites, and collab credentials](issues/34-frontend-content-adoption.md) | Suite frontend Writer, Slides, and Sheets | [33](issues/33-frontend-sharing-and-links.md) | ready-for-human |
| [35 — Implement Cleanup with refusal gates and fixture tests](issues/35-cleanup-implementation.md) | Suite migration | [29](issues/29-build-records-and-report.md) | ready-for-agent |
| [36 — Activate Cleanup after the Build release and client migration](issues/36-cleanup-later-release.md) | Suite release operations | [31](issues/31-migration-rehearsal.md), [34](issues/34-frontend-content-adoption.md), [35](issues/35-cleanup-implementation.md) | blocked |
| [37 — Consolidate storage after a successful Build](issues/37-relocation-execution.md) | Frappe storage operations | [06](issues/06-relocation-implementation.md), [31](issues/31-migration-rehearsal.md) | blocked |

## Coverage

| Accepted spec area | Tickets |
|---|---|
| Architecture, public facade, imports, lifecycle composition | 01, 07, 16, 30 |
| Schema, root pairs, grants, ancestry, indexes | 07–09, 15, 27 |
| Roles, links, passwords, removal versus deny, expiry retention | 07–08, 19–20, 22, 33–34 |
| Quota, reservations, root administration, offboarding | 10–11, 15, 21, 29 |
| Node lifecycle, upload, explicit restore, copy | 10–11, 16, 21, 25, 32 |
| Versions, previews, comments, activity, personal lists | 08, 10, 12–14, 22, 28–29 |
| Content contracts, Writer, Slides, Sheets, Satellites | 16–20, 28, 34 |
| All five daily jobs | 11–16, 30 |
| HTTP routes, shapes, errors, batch, legacy compatibility | 21–23, 32–34 |
| WebDAV, hidden content files, ordinary office files | 24–25 |
| Seven framework asks | 02–06; 03 covers asks 2 and 7, 04 covers asks 3 and 5 |
| Additive Build, mappings, report, rollback evidence | 26–31 |
| Later Cleanup, source deletion, runtime gates | 35–36 |
| Optional post-Build storage consolidation | 06, 37 |

## Handoff

An implementation session starts by reading this guide, then the first eligible ticket.
Each fresh session can continue from ticket status and recorded evidence.
This backlog supplies the work graph; an AFK runner must still enforce the rules above.
