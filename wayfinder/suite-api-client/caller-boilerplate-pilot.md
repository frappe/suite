# Caller error handling migration

Date: 2026-10-06

Ordinary Vue event handlers can omit catches that only stop success UI after a refused mutation.
The initial pilot covered Rename and the live files page's shared Move/Copy picker.
The completed migration removes 61 caller catches relative to the committed API refactor.
Promises still reject. Success code runs only after the awaited operation succeeds.

## Changes

- Rename binds the field directly to `mutation.error?.message` and keeps `silent: true`.
  It resets mutation state when the dialog opens, closes, or selects another node.
- The single-item Move/Copy picker uses default mutation feedback and has no local catch.
  Its batch workflow still handles partial results.
- Bootstrap installs the API error handler after Sentry initialization.
  The engine records feedback ownership before rethrowing, including silent refusals.
  This avoids a race with the lazy feedback import.
- The handler ignores cancellation and handled mutation refusals below HTTP 500.
  It forwards query failures, programming errors, and server faults to Sentry's existing handler.
  Without tracking, it reports unexpected errors to the console.

## Live verification

The pilot's browser checks used `drive-layer.localhost:8084` and fresh, isolated QA folders.
The refusal checks used real server responses.

| Flow                                      | Observed result                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rename to an occupied title               | HTTP 409. The draft stayed open with its entered name and an inline error. No toast.            |
| Correct the refused rename                | The server saved the new title. The listing updated and the dialog closed.                      |
| Move into a folder with an occupied title | HTTP 409. The picker kept its destination and showed one error toast per attempt.               |
| Remove the conflict and retry Move        | The server changed the parent. The picker closed and showed the normal success toast with Undo. |
| Undo Move                                 | The server restored the original parent and the listing updated.                                |
| Trash the source while Copy is open       | The server refused the copy. One error toast appeared and the picker stayed open.               |
| Restore the source and retry Copy         | A new node appeared in the destination. The picker closed and showed the normal success toast.  |

The observed refusal flows produced no unhandled promise rejections.
The Rename field retained its focus and title selection behavior.
All QA nodes, including the copied node and trashed conflict, were purged after verification.

## Automated verification

Behavior tests cover nested Vue events, the installed Frappe UI Dialog's async actions,
inline state, pending state, successful retry, cancellation, and imperative rejection.
They also cover transfer feedback, unhandled reads, broken response contracts, server faults,
and forwarding to an existing error handler.
Rename tests cover file stem selection, retained drafts, disabled submission while pending,
cleared feedback on reopen, and closing only after a successful retry.

The shared-client and legacy suites pass. Formatting, lint, typecheck, untranslated-text,
contract, import, bundle-budget, and production-build checks pass against their existing baselines.
The initial static graph remains 1.82 KiB gzip across two chunks.

Mail was not tested end to end in this pilot. Sentry forwarding was tested with an existing handler,
without sending events to an external Sentry project.

## Migration findings

A focused syntax scan for the pilot found 63 mutation-related catches in product files that directly import `@/api`.
Of these, 19 catches in 12 files contained only comments or a bare return.
These were review candidates, not an automatic migration list.
The scan does not prove that a framework awaits each callback or that the workflow needs no recovery.

| Caller pattern                                         | Migration                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Async Vue event handler with default mutation feedback | Remove the empty catch. Keep the await and success UI after it.                             |
| Inline error presentation                              | Bind `mutation.error`, keep `silent: true`, and reset on context changes.                   |
| Frappe UI Dialog action                                | Return the async handler's promise. Dialog's `finally` resets its own loading state.        |
| Caller-owned loading or cleanup                        | Keep `try/finally`. Remove the catch only if it has no recovery behavior.                   |
| Retry toast or a refusal-specific next step            | Keep local handling. For example, Trash offers Retry and restore can ask for a destination. |
| Composite workflow or partial completion               | Keep local handling. Creation, uploads, batches, and Undo need their workflow decisions.    |
| Timer, subscription, or detached `void` call           | Keep explicit handling. Vue cannot observe a promise that the callback does not return.     |
| Awaited query or refetch                               | Review separately. Queries do not receive default mutation feedback.                        |

## Completed migration

The remaining ordinary callers now use shared feedback or their mutation's inline error state.
The migration covers script handlers and template callbacks in Drive, Mail, Calendar, Meet, Home, and the shell.
Mail login and signup still handle authentication and validation queries locally.
Editor recovery, upload cleanup, Undo, batch outcomes, custom failure messages, and background tasks retain local handling.

The callback must return its promise. Frappe UI's desktop menus discard those promises.
`Dropdown` and `ContextMenu` from `@/platform/feedback` preserve menu behavior and report rejections through the application handler.
`AdaptiveDropdown` uses the desktop adapter and returns the mobile action promise.
Mail's Screener switch saves through a Vue event instead of a computed setter.
The adapters preserve Frappe UI's public prop, model, and slot types.
Template double-click returns the creation promise to Vue.
External-link visits use default feedback; background folder visits remain silent.

WebDAV switch optimism belongs to the Drive policy.
Pending read changes survive concurrent refreshes and restore the latest server answer after refusal or cancellation.
Mail layout uses the mutation's pending state instead of a separate saving flag.
Meet lobby refusals leave waiting participants unchanged and skip success bookkeeping.

## Additional verification

The completed migration adds tests for the installed desktop and context menus, the mobile sheet, template creation, keyboard invites, and lobby decisions.
The tests cover pending state, refusals, retry, success events, cancellation, and unexpected diagnostics.
Menu tests also cover controlled open state, custom slots, nested actions, and switch arguments.
WebDAV tests cover overlapping saves and refreshes, refusal rollback, and quiet cancellation.

All 484 shared-client tests pass across 92 files. The full legacy suite passes.
Typecheck, lint, untranslated-text, contract, and import checks pass against existing baselines.
Scoped formatting, both production builds, and the bundle-budget check pass.
The final static graph is 1.83 KiB gzip across two chunks, below the 200 KiB budget.

The legacy fixture now installs the same application error handler.
The legacy runner also checks Vitest's exit status, so unhandled errors cannot pass when assertions succeed.

Live checks used only `drive-layer.localhost`.
The existing server at port 8084 served stale Vue bindings for the Drive settings panel.
A fresh, isolated server at port 8085 compiled the panel correctly.
The icon agent's server, files, and sample folder were preserved.

| Flow                                         | Observed result                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop Star and Unstar                      | The server saved each change and the menu closed normally.                                                                                                                     |
| Delayed menu action after permanent deletion | A real HTTP 404. The menu closed without an unhandled rejection.                                                                                                               |
| External link with a refused visit           | A real HTTP 404 showed one error and prevented opening the link, preserving the previous failure behavior. Retry reached `window.open` with the original URL and safety flags. |
| Enable WebDAV                                | The switch changed immediately and stayed disabled while saving. Connection details appeared after the saved read.                                                             |
| Refused user WebDAV save                     | A malformed request injected at the transport boundary produced a real HTTP 400. The switch rolled back, re-enabled, and showed one error toast.                               |
| Retry user WebDAV save                       | The server saved the change and the switch stayed checked.                                                                                                                     |
| Disable user and site WebDAV                 | The server restored the original disabled settings.                                                                                                                            |

The browser checks did not regenerate API secrets or send invitation emails.
All QA nodes were purged and both WebDAV flags were restored to their original values.
At that stage, Mail and Calendar had not been tested against a configured JMAP service.
Their callback behavior was verified through the shared client and component tests.
Meet lobby tests used real generated references with a fake HTTP boundary.

## Read-only Mail and Calendar follow-up

The user subsequently authorized read-only checks on `rehearsal.localhost`, which contains live data.
These checks reproduced and corrected four screen-loading failures:

- Mail returns boolean mailbox subscriptions. The contract required numeric flags and rejected the folder list.
- Calendar participants can have null scheduling IDs, delivery targets, descriptions, and comments.
  The contract required non-null values and rejected the event list.
- Calendar read its widget date before the widget mounted. The initial month now comes from the route.
- Mail called `threadRow` without importing it. The mailbox page now imports the existing helper.

Backend response declarations and generated contracts, references, and validators changed together.
Mailbox display types now use the generated response type instead of a duplicate interface.
Response validation remains enabled. Regression tests accept the observed boolean and null values
and still reject malformed values through the real HTTP transport and generated references.

A source review also found a reading-pane star handler calling the removed resource `.submit` API.
It now calls the account-aware mutation helper. A local fake-HTTP test covers refusal, retry,
and account changes. This action was not performed against live data.

| Read-only screen | Observed result                                          |
| ---------------- | -------------------------------------------------------- |
| Mail Inbox       | 29 rows, folder navigation available, no runtime errors. |
| Mail Sent        | 30 rows, no runtime errors.                              |
| Mail All Inboxes | 29 rows, no runtime errors.                              |
| Calendar Month   | 28 events, no runtime errors.                            |
| Calendar Week    | 6 events, no runtime errors.                             |
| Calendar Day     | 1 event, no runtime errors.                              |
| Calendar Agenda  | 73 events, no runtime errors.                            |

The isolated QA server blocked mutation routes before proxying requests.
No mutation requests were attempted, and the screen reads returned HTTP 200.
Mail Inbox and Calendar Month also rendered on the normal development server at port 8084.
The Calendar view preference was restored to Month.
No message threads or event details were opened, and no live mail or calendar data was changed.

All 486 shared-client tests pass across 93 files, and the full legacy suite passes.
The new reading-pane action test runs in the legacy suite.
Typecheck passes with no errors in scope; existing Mail type debt decreased by three findings.
Lint, contract, import, untranslated-text, scoped formatting, both production builds,
and focused Python lint and formatting checks pass.
