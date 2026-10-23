# Suite API client implementation

Status: complete. All stages in the [plan](suite-api-client-plan.md) are implemented against the [specification](suite-api-client-spec.md).

The starting revision was `7a6b419a49b4b92cd489fd13636d430d3b45220b` on `forge/drive-layer`. Backend tests and browser checks used **drive-layer.localhost**. No tests used rehearsal.localhost.

## Result

Ordinary requests now use a generated reference with `client.query`, `client.mutation`, `useQuery`, `useMutation`, `useInfiniteQuery`, or `useUpload` from `@/api`. Vue observers and imperative calls share one cache, in-flight map, entity store, write queue, and owner effects pipeline. Policies and validators load on first use. Owners retain their document, creation, transfer, and collaboration workflows.

The engine partitions reads and persisted entities by session and opaque access identity. It isolates consumer cancellation, rejects failed writes, guards late replies, and rolls back only the failed attempt. Default feedback and owner error handlers report the same refusal once. Mail confirmations follow successful writes, even when rows update optimistically. Challenge handlers run outside the write queue so an unlock can complete before an explicit retry. Declared mutations do not receive automatic retries, including mutations whose existing endpoint uses GET.

Drive owns selected share links, unlock tickets, final request outcomes, access changes, and upload scope. Editors pass an owner-selected request context through the same engine. This preserves document access without constructing another transport request API. Backend permissions, HTTP URLs, and existing operation IDs remain authoritative.

## Catalog and caller inventory

The [operation inventory](operation-inventory.json) records all 336 generated HTTP operations and the Drive transfer workflow: owner, stable ID, public name, kind, method, path, direct consumers, scope, error behavior, paging, byte capability, effects, and adapter removal status. Computed policy fields include their owner implementation. A consumer list can be empty when an endpoint has no current frontend caller. Named workflows can call a reference through a shared helper; their caller groups are listed below.

| Owner | Queries | Mutations | Paged reads | Byte reads | Converted caller groups |
| --- | ---: | ---: | ---: | ---: | --- |
| Suite | 9 | 12 | 1 | 0 | Account, people, invitations, site settings, onboarding, preferences, theme, push subscriptions |
| Drive | 19 | 46 | 5 | 3 | Details, lists, roots, grants, shares, visits, settings, comments, versions, notifications, access changes, creation and transfer workflows |
| Mail | 74 | 106 | 14 | 3 | Inbox, threads, drafts, send/schedule, screening, contacts, calendars, imports/exports, identities, preferences, account/domain/member administration, reports and authentication |
| Meet | 8 | 20 | 0 | 0 | Rooms, members, invites, settings, search and document commands |
| Calendar | 7 | 13 | 0 | 0 | Calendars, events, invitations, sharing, search and settings |
| Writer | 1 | 4 | 0 | 0 | Document reads, document/HTML/comment saves, settings and automatic versions through Drive |
| Sheets | 5 | 2 | 0 | 0 | Document reads and persistence, versions, AI and link previews |
| Slides | 7 | 3 | 0 | 0 | Document reads and saves, templates, composite groups and adoption |

Each generated mutation has an owner decision about effects or explicit `none`. The catalog coverage test rejects missing decisions and invalid reader IDs. Behavioral tests independently verify visible list/detail outcomes, rather than using policy arrays as expectations. Mail offset endpoints now return explicit page envelopes. Cross-account fetches stop at their declared bound instead of repeating an earlier page.

Generated changes include backend route declarations, all eight owner `contract.json` files, typed `generated.ts` catalogs, lazy `validators.ts` modules, and the generator fixture contract. No new HTTP aliases were introduced.

## Removed request paths

The old query, mutation, infinite, and upload descriptor builders, `driveOperation` wrapper, non-throwing mutation adapter, private inbox cache, and ordinary frappe-ui resource factories have no production consumers and are removed. Awaited callers handle rejection before success UI, editor save state, modal closure, or navigation. The API architecture check rejects new ordinary resource factories, descriptor imports, direct transport imports, and raw requests outside the protocol inventory.

`STANDARDS.md`, `ARCHITECTURE.md`, `frontend/AGENTS.md`, and composition guidance describe the public client and owner registration. The old server-state guideline links to the specification and is marked superseded.

## Retained protocols

These are product or platform protocols, not temporary ordinary API adapters. File paths below are relative to `frontend/src/`.

| Owner | Exact boundary or caller group | Reason and removal condition |
| --- | --- | --- |
| Platform | `boot/start.ts`, `platform/session/index.ts`, `platform/translation/index.ts` | Bootstrap, identity transitions and translation loading run before ordinary observers. Identity and translation requests use generated references. Replace only with a bootstrap that preserves ordering, logout cleanup and guest behavior. |
| Platform | `platform/pwa/frappe-push-notification.ts` | External notification relay and Firebase protocol. Ordinary server subscribe/unsubscribe calls use generated mutations. Remove only when that relay protocol is replaced. |
| Drive | `apps/drive/client/links.ts` | One-credential target probes reconcile held links, generations and unlock tickets. Retain while selected share-link access exists; any replacement must preserve those outcomes and limits. |
| Drive | `apps/drive/client/uploads.ts` | Chunk/direct-byte upload, probe, resume, finish, progress and cancellation. Public callers use the transfer reference. Retain until the upload protocol changes. |
| Drive | `apps/drive/client/session.ts`, `apps/drive/files/features/preview/textContent.ts` | Scoped file bytes and document session media requests. Ordinary document reads/writes use the engine. Replace only with an equivalent scoped byte capability. |
| Writer | `apps/writer/surface/exports.ts`, `apps/writer/utils/docxexporter.js`; Writer Yjs providers | Export media bytes and collaboration. Ordinary saves, reads, settings and versions use generated references. Remove only when export or collaboration protocols change. |
| Sheets | `apps/sheets/utils/relay.js` and its collaboration callers | Exact Yjs relay endpoint. It cannot dispatch ordinary endpoints. Remove only when the collaboration relay is replaced. |
| Slides | `apps/slides/service-worker.js`, `apps/slides/stores/offlineCopy.js`, `apps/slides/stores/element.js`, `apps/slides/utils/slidesRequests.js` | Service-worker request classification, offline warming and element media bytes. Ordinary presentation requests use generated references. Replace only when offline/media protocols change. |
| Mail, Calendar | `utils/useChunkedUpload.ts` and import callers | Multipart/chunk transfer with progress and cancellation. Import/export commands and status reads use generated references. Remove only when the transfer protocol changes. |
| Mail, Writer | frappe-ui `useFileUpload` callers in composers, attachments, embedded media and document imports | Multipart file transfer. This remains separate from ordinary resource factories. Replace only with a transfer that preserves file metadata and progress. |
| Platform, Meet, editors | Socket.IO, WebRTC, SFU and Yjs clients | Long-lived realtime, media and collaboration protocols. They are not ordinary HTTP queries or mutations. Retain while their protocols exist. |

There are no remaining uncontracted ordinary frontend paths. Do not add ordinary requests to a protocol exception.

## Verification

| Check | Result |
| --- | --- |
| Unified frontend suite | 87 files, 467 tests passed |
| Legacy frontend suite | Passed; expected-failure manifest is empty |
| Backend contract export | Reproduced all eight owner contracts exactly |
| Generated TypeScript drift | `yarn check:contract` passed for nine contracts |
| Typecheck | Zero in-scope errors; existing out-of-scope debt decreased from 1,014 to 650 findings |
| ESLint | Passed; existing debt decreased from 571 to 488 findings; 532 existing warnings remain non-enforced |
| Untranslated text | Passed against the unchanged 928-finding baseline |
| Import and API boundaries | Passed; zero legacy Drive calls and no ordinary alternate request API |
| Bundle budget | 1.82 KiB gzip in the initial static graph, below the unchanged 200 KiB limit |
| Production and service-worker build | Passed |
| Formatting and Python lint | Scoped formatting preserves the initial unrelated edits; changed Python files pass Ruff |
| Backend HTTP, contract, registrations and client boundaries | Passed on drive-layer.localhost |
| Drive upload, rename and view tests | 98 tests passed on drive-layer.localhost |
| Mail thread behavior | 11 tests passed |

All debt baselines are unchanged or smaller. The startup graph contains no eager product policy or validator imports. Generated schemas and validation load with the requested owner.

Real browser checks covered Suite account/preferences, Drive detail/list rename, named and covered link access, guest refusal, password challenge and explicit retry, revoked-link cache isolation, paging to exhaustion, external rename through realtime, byte download, upload/resume/cancel, and editor open/save. Writer text, a Sheets cell, and a Slides transition were changed through their actual UI and confirmed in server reads. All six temporary Drive nodes were purged; fresh reads return 404. The temporary password grant and its browser test state were removed.

The Mail contact integration class was skipped because this test site has no configured Suite Cloud/Stalwart integration. Those external integration flows were not claimed as verified. Suite route tests also retain one existing configured-site skip. Mail contracts, pagination boundaries, rejection behavior and frontend scenarios passed.

## Initial unrelated edits

The following files were already dirty or untracked at the start and remain outside the implementation scope and are excluded from final formatting: `frontend/index.html`, `suite/hooks.py`, `suite/mail/jmap.py`, `suite/mail/tests/test_jmap_client.py`, `suite/www/suite.py`, `frontend/src/boot/start.test.ts`, `frontend/src/boot/start.ts`, `frontend/src/start.ts`, and `suite/mail/framework.py`. The requested Wayfinder plan/specification folder was already untracked and is part of this task's scope.
