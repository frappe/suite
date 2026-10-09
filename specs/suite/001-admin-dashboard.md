# Unified Suite admin dashboard

Status: accepted

Scope: single-site administration of Suite users, business roles, Mail, and combined Mail + Drive storage. This is an implementation contract, not evidence of shipped functionality.

Decision history: [Unified Suite admin dashboard map](../../.scratch/suite-admin-dashboard/map.md). This document consolidates the final decisions; superseded hard-Mail enforcement, warning-only Drive, and special-development onboarding proposals must not be implemented.

Architecture and vocabulary: [Suite architecture](../../ARCHITECTURE.md), [coding standards](../../STANDARDS.md), [Drive domain](../../suite/drive/CONTEXT.md). “Site” is the accounting boundary; a business is not a new team/tenant entity. Admin/Normal User are business roles, distinct from Drive's Read/Comment/Upload/Edit/Manage grant ladder.

Terminology clarification: use **Mail account** for the provisioned email identity and its stored messages (called “mailbox” in some historical decisions below). A **Suite user** is the preserved Frappe User identity. “Delete Mail account” does not mean deleting the Suite user. Mail protocol folders remain mailboxes where that is the protocol's actual term.

## 1. Outcome and exclusions

One Admin dashboard replaces the existing Mail dashboard and workspace General/Users administration. It manages users, roles, storage, business settings, and the existing Mail administration capabilities. Personal settings remain separate.

Out of scope:

- Integrations, including HR; billing; multi-site operator administration.
- Arbitrary Frappe role assignment or permanent Suite User deletion.
- Full standalone Mail provisioning/onboarding or new standalone allowance configuration.
- A separate development/mock onboarding mode or local Suite Cloud infrastructure setup.
- A new cross-product reservation system or storage-quota enforcement on Mail.

Breaking changes are acceptable. Compatibility redirects are not required. Non–Suite Cloud sites must retain available core/local administration and ordinary access.

## 2. Instance behavior and authorization

### 2.1 Instance classification

Use existing server-side `is_suite_cloud_configured()`:

| Category | Behavior |
| --- | --- |
| Suite Cloud configured | Provider-backed onboarding, Mail administration, combined accounting, and Drive enforcement described here. A self-hosted instance configured with Suite Cloud opts into the same rules. |
| Non–Suite Cloud | Preserve local onboarding/login, mailbox-less users, existing Mail access where independently configured, and local Drive quotas. Hide unavailable provider-dependent controls. Do not claim combined enforcement or invent a provider allowance. |

Configuration means URL/key/secret are present, not that credentials are valid or resources ready. Provider failure does not reclassify a configured instance as standalone. Development uses these same categories and real onboarding against a configured local/test provider. `developer_mode` does not bypass readiness, activation, or security requirements.

### 2.2 Admin boundary

- Business roles are **Admin** and **Normal User** only. Admin maps to Suite Admin; normal users retain required baseline product roles but receive no arbitrary-role editor.
- Hide the Admin entry and refuse administration requests for Normal Users. Enforce permissions server-side for reads, writes, exports, refreshes, and bulk operations.
- System Manager is a technical Frappe role, not an independent dashboard-access grant. The special Administrator identity retains recovery access; it is not a normal employee or mailbox-bound account.
- Admins cannot disable themselves or demote the last active Admin. Protect those invariants under concurrent requests, not just through disabled UI controls.
- Audit sensitive mutations and their outcomes without logging passwords, invitation tokens, or other secrets. Existing product access/grant checks remain in effect.

## 3. Onboarding and domains

For configured instances, complete business onboarding only after server-side confirmation of provider connectivity, a ready/verified business Mail domain, the first Admin's provisioned mailbox, and a confirmed site allowance.

Suite Cloud supplies a ready-to-use Mail domain such as `company.frappe.cloud`, supporting addresses such as `alice@company.frappe.cloud`. Provider-controlled verification requires no customer DNS work. This is a required provider capability, not a verified existing default-domain implementation.

- Custom domains are optional. Support multiple domains, added later in Admin → Mail → Domains.
- Adding a domain never renames users, migrates mailboxes, or assigns aliases automatically. Admins explicitly assign available addresses/aliases.
- Keep the supplied domain and its existing addresses available after custom domains are added.
- Failed onboarding retains completed steps and supports retries without duplicate domains/mailboxes. Do not complete onboarding with missing resources.
- Domain verification loss after onboarding raises a Mail-health alert, not a Suite-wide login lockout. Admins must retain access to remediate it.
- Temporary provider connectivity failure preserves existing access. Explicit provider suspension blocks normal configured-instance access while retaining special Administrator recovery access. Suspension is not a storage-quota consequence.

## 4. User lifecycle

### 4.1 Identity and creation

Every normal user on a configured instance requires a provisioned business mailbox before normal access. Non–Suite Cloud users do not acquire that new gate.

Offer two creation paths:

1. **Invite:** Admin chooses business address and role, with an invitation sent to a separate existing contact address, such as personal email. Recipient accepts and chooses their password. Activation requires successful resource setup.
2. **Create directly:** no contact email required. Suite generates a strong temporary password and discloses it once to the creating Admin. Normal access remains blocked until the user changes it at first login.

The Admin can replace a temporary password but cannot retrieve it later. Provide safe-sharing guidance; never log secrets. Temporary passwords and invitation links expire after seven days. Replacements invalidate predecessors. Resending an invitation invalidates its earlier acceptance link. Changing an invited address or role requires a new link.

Enforce mandatory password change across browser, API, and Mail-client paths, including IMAP/JMAP. Permit only password change/logout until complete; incoming Mail may continue. Account setup readiness and forced password change are distinct requirements.

Use action progress followed by Active or Setup failed; do not expose a persistent Provisioning account status. Invitations retain Pending/Expired states. Repeated acceptance/creation/retry requests reuse the same operation and reject competing creation for an already claimed address. Failed setup is retryable and never grants mailbox-less or partial access.

### 4.2 Disable and reactivate

- Disabling revokes browser/API/Mail sessions, blocks login and outgoing Mail, and preserves data. Existing Mail clients must not bypass suspension.
- Incoming Mail continues by default. Offer a separate **Suspend incoming Mail** action, retaining the mailbox and warning that new deliveries are rejected and may bounce.
- Archive the Personal Root while preserving content and existing grants. Other users retain their granted access. Reactivation restores the same root.
- Reactivation occurs only after the mailbox and Personal Root are ready. Failure leaves the user disabled with a retryable error, not partially active.
- Disabled users' retained data continues counting toward personal/site totals.

### 4.3 Mail account deletion

Expose **Delete Mail account**, never Delete Suite user. Require a disabled Suite user, a consequence preview, and typed-address confirmation.

- Permanently remove Mail content, aliases, and group/list memberships; preserve the disabled Suite identity and Drive data.
- Invalidate prior Mail credentials/sessions. Address reuse must never revive old access.
- Release the primary address for reuse only after deletion is confirmed consistent. Warn about future messages reaching a new holder.
- A recreated mailbox is empty; deleted messages/memberships do not return. If the old address has been reassigned, require another available address; never reclaim it automatically.
- Recreating the mailbox does not reactivate the Suite user. Reactivation is separate and readiness-gated.
- Partial failure reports Deletion failed, identifies completed effects, permits retry, and keeps the user disabled until consistent.

Current `suite/mail/api/admin.py:delete_members()` deletes the Frappe User and triggers cross-product deletion hooks. It is **not** the required mailbox-only operation and must not be exposed by the new dashboard.

## 5. Disabled-user Drive transfer

An Admin can explicitly move a disabled user's entire retained personal Drive contents into a named folder in another user's Personal Root or a designated shared folder. Do not transfer automatically on suspension; selective offboarding transfer is not included in this version.

- Include retained versions and trash. Trash remains deleted, not restored into the visible folder, and is attributed to destination personal/shared storage.
- Preview destination combined usage/cap and access changes. Personal destinations must fit their combined cap plus granted buffer; shared destinations have no personal cap. A byte-neutral site transfer is not refused solely because site allowance is exhausted.
- Preserve existing explicit grants; destination inheritance applies. Require confirmation of access expansion. Preserve stable links where technically supported and disclose any incompatibility rather than silently promising it.
- Show progress and per-item failures; retry only unfinished work without duplication or double-counting. Do not promise an all-or-nothing transfer.
- On completion the source retains an empty Personal Root. Reactivation restores it; transferred content stays at the destination. During partial transfer the root still contains remaining items.

## 6. Storage model and policy ownership

### 6.1 Accounting

Use integer bytes in contracts/calculations and decimal GB in user-facing display/input: **1 GB = 1,000,000,000 bytes**. Do not label GiB quantities as GB.

| Quantity | Includes |
| --- | --- |
| Personal stored usage | Personal Drive content + that user's Mail content. |
| Site stored usage | All personal and shared Drive/Mail content, including disabled users and group mailboxes. |
| Drive reservations | Promised bytes, displayed separately and included exactly once in Drive admission checks. |

Retained trash, file versions, Mail messages/attachments, and retained copies count until permanently removed. Aliases have no separate usage or allowance. Mailing lists count any retained content; delivered copies count in receiving mailboxes. Shared uploads are charged to the Shared Root/site, not the uploader's personal allowance. Moving content changes personal attribution, not site bytes.

Exclude generated previews, database indexes, and infrastructure overhead. Preserve Drive's existing content accounting definition; do not introduce charges for app document bodies merely because their Drive Nodes exist. Provider Mail usage is actual retained usage, not allocated quota.

Drive Root `used_bytes` already includes reservations. Reporting must subtract/separate reservations to show stored-only totals; admission must not add reservations a second time.

### 6.2 Limits and buffers

- Suite Cloud owns the site base allowance, supplied through `site.ping` → `limits.max_disk_gb` with its revised combined-allowance meaning. Suite Admins cannot directly raise it.
- Suite stores optional combined personal caps, explicit personal-buffer grants, and the optional new-user default. Personal caps do not reserve site capacity.
- Default users are uncapped, sharing available site capacity. Bulk cap changes apply the same cap to each selected user, never a shared pool.
- Site buffer is automatic 10% of base allowance. Personal buffer is explicitly Admin-granted 10% of the current cap, persistent until revoked. No timer in this version. Round percentage headroom down to whole bytes.
- Removing a personal cap clears its buffer grant. Reapplying a cap requires a fresh grant. Changing a capped user's cap preserves its grant and recalculates the percentage. Use separate bulk grant/revoke actions.
- Default changes affect future creations/invitations only. Snapshot the default when an invitation is created; allow explicit edits to pending invitation caps.
- Bulk actions show previews and per-user results. Keep successful changes if others fail; retry failed items.
- Lowering a cap/allowance or revoking headroom may put usage above threshold. Warn, preserve data, and block subsequent unadmitted Drive growth; do not restrict Mail or automatically delete content.

### 6.3 Drive-only enforcement against combined usage

**Mail is unlimited by storage quota. Drive is not.** Mail continues receiving/sending through Suite and external clients even beyond site/user thresholds. Authentication, activation, delivery suspension, and infrastructure failures remain separate constraints.

For a new Drive addition, check:

```text
site projected charge = site Drive stored bytes
                     + site outstanding Drive reservations
                     + cached site Mail bytes
                     + new unreserved bytes

personal projected charge = destination user's Drive stored bytes
                         + destination user's outstanding Drive reservations
                         + cached personal Mail bytes
                         + new unreserved bytes
```

Personal additions must fit both effective personal cap (if configured) and effective site allowance. Shared additions check site allowance only. An admitted reservation replaces the unreserved-byte term, not adds to it. Reuse Drive's atomic admission/reservation behavior and serialize site checks so concurrent roots cannot independently spend the same available site capacity.

- Check every Drive write path, including API/WebDAV and product workflows, on the server. Uploads, copies, retained-version creation, and edits that add charged bytes cannot bypass admission through UI or another transport.
- Honor valid already-admitted operations if limits drop; no further growth beyond the current threshold. Preserve existing reservation recovery semantics.
- Preserve reading, downloading, and cleanup. Moving to trash does not free allowance; permanent removal of retained content does. Byte-neutral operations follow destination personal attribution/limits without requiring new site capacity.
- Explain personal limit, site limit, or missing measurement as distinct blockers. Mail growth can block future Drive additions even if no Drive content changed.
- This is **approximate combined accounting**, not an exact combined hard ceiling. Mail is unrestricted and cached Mail figures may lag.
- On configured sites replace—not stack with—old personal/shared Drive quota defaults. Standalone sites retain existing local quota behavior.

## 7. Provider usage integration and cache

Reuse existing provider APIs; do not require a new bulk group endpoint or cross-product reservation service.

| Call | Required use |
| --- | --- |
| `mail.accounts.get_quotas(emails=...)` | Site-owned email-keyed `used_disk_bytes`; batch at most 500 addresses. Do not use `disk_quota_gb` as usage. |
| `mail.groups.get_group(email=...)` | Actual group-mailbox usage through the existing detail call. |
| `site.ping` | Site status and `limits.max_disk_gb` allowance, after provider semantic changes. |

Inventory must include retained/disabled mailboxes and groups, not only the enabled users on a dashboard page. Preserve identity attribution through address changes/reuse; a new holder must not inherit the deleted mailbox's cached usage or credentials. Clear/update inventory and attribution on confirmed deletion/recreation.

Cache successful Mail measurements on the site for **six hours**. Store per-entry success timestamps because inspected usage responses do not include measurement times. Label these as fetch times, not an atomic provider snapshot. Admin refresh bypasses cache; partial failures do not discard successful values.

| Condition | Reporting and Drive behavior |
| --- | --- |
| Successful value within TTL | Use it for combined reporting/admission. |
| Expired value during provider failure | Retain/use last success, labelled stale; accept approximate enforcement. |
| Missing/null result with prior success | Retain prior value/timestamp, visibly stale or refresh-failed. Never replace with zero. |
| No personal Mail value ever measured | Unknown, not zero; affected personal Drive additions cannot proceed. |
| Site inventory has an unknown retained mailbox with no prior value | Site total is incomplete; all new site Drive additions pause until measurable. |
| No successful allowance yet | Cannot establish effective site threshold; preserve remediation/read access but do not admit new configured-site Drive growth. |

Keep reporting useful under partial failure: show known breakdowns with incomplete/unknown metadata rather than a misleading complete total. Unknown and legitimate zero bytes are different values. Known stale values may be used even after TTL; TTL is a refresh policy, not a reason to lock out users.

Existing Suite references: `suite/mail/api/admin.py:_attach_quotas`, group detail, and overview `site.ping`. Existing provider references: `suite_cloud/api/mail/accounts.py:get_quotas`, `suite_cloud/api/mail/groups.py:get_group`, and `suite_cloud/cloud_mail/tenancy/usage.py`.

## 8. Dashboard screens

Entry: an **Admin** item in the Suite app switcher, visible only to authorized Admins.

| Section | Content/actions |
| --- | --- |
| Overview | Combined site usage, base allowance/headroom, Mail/Drive and personal/shared breakdowns, users/invitations, actionable alerts linking to remediation. |
| Users | Search/list users and invitations; invite/direct-create; profile, role, status, combined usage/cap/buffer; aliases and memberships; disable/reactivate; Mail delivery controls, mailbox-only deletion/recreation, and disabled-user Drive transfer. |
| Storage | Site totals/breakdowns, reservations separately, user usage/limit table, individual/bulk cap and buffer actions, new-user default, timestamps/stale/unknown states, Admin refresh. |
| Mail → Domains | Add/list domains; ownership/DNS verification, description, catch-all, subaddressing, relaying, enabled state, DNS results and zone/CSV/JSON export; deletion subject to valid product constraints. |
| Mail → Groups | Create/list/search/delete group mailboxes; descriptions, members, aliases/enabled states, actual shared usage. Remove obsolete independent storage-quota controls. |
| Mail → Mailing lists | Create/list/search/delete lists; descriptions, aliases/enabled states, recipient listing/add/remove. Do not invent unsupported recipient-state controls. |
| Mail → Reports | Read-only DMARC/TLS summaries/details, domain/search filters and existing retention windows. |
| Settings | Business name/logo, replacing workspace General administration. |

Account/invitation controls also retain relevant existing functionality: names/display names, locale/timezone, password reset safeguards, invitation resend/expiry/revocation, and membership/alias management. Do not duplicate Mail Accounts outside Suite Users. Adapt old Mail quota editing to combined personal policy rather than retain separate Mail caps.

Individual cap controls are available in both User details and the Storage table using the same behavior; bulk controls live in Storage. Display configured cap, granted buffer, effective threshold, site threshold, and measurement age explicitly. Uncapped is not zero usage.

Warn at **90% of configured personal cap** and **90% of site base allowance**, with stronger buffer-use/over-threshold alerts. Uncapped users have no personal-cap percentage warning. Prioritize failed provisioning, partial deletion/transfer failures, domain health, missing/stale usage, and storage problems. Storage alerts must not imply Mail will stop at the threshold.

For standalone sites retain Users, Settings, local Drive administration, and accurate Drive-only labels. Hide unavailable provider operations; do not remove independently configured end-user Mail access. Existing personal settings stay separate.

## 9. Ownership and implementation contract

Follow existing module boundaries, without a broad unrelated refactor:

- **Suite Core:** business identity/role policy, local limit/default/buffer settings, site onboarding and business branding. No imports of private Mail/Drive implementations.
- **Mail:** provider directory operations, mailbox/delivery lifecycle, aliases/groups/lists/domains/reports, existing usage client and normalization.
- **Drive:** storage accounting, reservations, transfer, and server-side combined-limit admission. Own concurrency/recovery; no quota enforcement delegated to the browser.
- **Suite composition:** explicit cross-product orchestration and wiring of provider-backed usage/policy into complete lifecycle/storage outcomes via public product interfaces.
- **Frontend shell/composition:** app-switcher registration and routing; one admin UI with product-owned features and reusable dashboard primitives. Do not make the shell call product internals or duplicate authorization.
- **Suite Cloud:** revised allowance semantics, unlimited Mail configuration, supplied domain provisioning, and provider-side identity/credential lifecycle support.

Expose complete workflows, not a client sequence of partial mutations. New Suite HTTP operations follow repository resource/route-table conventions and generated typed contracts. Exact route names/DocType layout are implementation design choices; the observable operations, errors, and authorization here are mandatory. Distinguish forbidden access, conflict/last-admin guard, invalid input, unknown usage, quota exceeded, and provider/setup failure by typed outcomes.

Lists/details must agree on identity, role/status, usage completeness/freshness, configured/effective limits, and operation results. Bulk writes return per-target outcomes; creation/deletion/transfer recovery must not be disguised as successful atomic completion.

## 10. Dependencies and rollout

### 10.1 Required provider changes, not yet verified shipped

Existing API reuse is verified; the following requirements are not certified implemented:

- Make account/group Mail storage quotas unlimited, including existing mailboxes, without interpreting an old positive quota as the new policy.
- Reinterpret `max_disk_gb` as the combined site allowance; retire allocation-sum constraints and mandatory positive Mail-quota defaults. Coordinate decimal-GB meaning and handling of existing configured values. Preserve existing legitimate unlimited-site semantics rather than turning a zero/unlimited provider allowance into a zero-byte denial.
- Provide/verify the default business Mail domain and first-user provisioning through onboarding.
- Ensure password-change gating, credential/session revocation, delivery suspension, and mailbox-only deletion can satisfy the required Mail-client behavior.

No new hard-Mail admission protocol is required. Provider/application implementation must verify actual capabilities; apparent UI completion is insufficient.

### 10.2 Rollout order

1. Coordinate provider changes and validate current API shapes/units in a real integration environment.
2. Add persistent business policy and cache metadata; migrate existing System Managers to Suite Admin once. Establish at least one active business Admin/recovery access.
3. Implement complete backend lifecycle/storage workflows and tests; switch configured Drive admission to combined policy without double-counting reservations or stacking legacy defaults. Retain standalone behavior.
4. Build the unified UI and onboarding handoff using generated contracts and shared authorization. Verify provider dependencies before enabling normal configured-instance onboarding.
5. Remove obsolete Mail dashboard routes and workspace General/Users screens and update internal entry links. No redirects; no interim administration gap or re-exposure of User-deleting endpoints.
6. Verify end-to-end acceptance across browser/API/WebDAV/Mail clients and provider failures, then deploy. Breaking changes are allowed, but never silently discard stored data.

## 11. Behavioral acceptance scenarios

Test public outcomes against independent expectations, including Normal Users—not only Administrator.

1. Normal User cannot load Admin data or mutate settings by direct API call. Migrated System Manager has Suite Admin; subsequently removing Suite Admin removes dashboard access despite System Manager.
2. Concurrent changes cannot remove the last active Admin; an Admin cannot disable themselves. Special Administrator can recover without an employee mailbox.
3. Default-domain onboarding works without custom DNS. A custom domain adds no automatic address changes. Failed provisioning is retryable without duplicates or normal access.
4. Invite via personal email and direct temporary-password creation both work. Expired/replaced links/passwords fail. Mail/API clients cannot bypass mandatory first password change.
5. Disabling invalidates old sessions and outgoing Mail access while incoming delivery continues. Explicit delivery suspension is separate. Reactivation failure preserves disabled state and retained data.
6. Delete mailbox never deletes User or Drive data. Partial failure prevents reuse/reactivation; confirmed deletion allows reuse without old credentials. Recreation yields an empty mailbox and requires explicit reactivation.
7. Transfer includes versions and still-deleted trash; preserves explicit grants, previews inherited expansion, retries without duplication, and leaves an empty source only on full completion.
8. Personal Drive 2 GB + Mail 8 GB displays 10 GB; shared/group content only affects site totals. Disabled data/trash remain counted. Reservations are shown/charged once, not included twice via root counters.
9. A 10 GB cap without grant rejects a Drive addition projecting over 10 billion bytes. With a grant, 11 billion is the effective personal threshold. Site 100 GB has 110 billion-byte threshold; applicable personal and site checks both hold.
10. Incoming/outgoing Mail continues above those thresholds, including Suite UI and external clients. Subsequent Drive growth blocks based on cached combined usage; no exact combined ceiling is advertised.
11. Uncapped user still faces site admission. Shared additions ignore personal caps. Concurrent additions across separate roots cannot both spend the same site headroom. Valid admitted uploads survive later limit reductions without new excess growth.
12. Bulk caps are individual, results preserve partial success, removing a cap clears headroom, and pending invitations retain their creation-time default.
13. Account batches cover more than 500 entries; group usage contributes to site totals. Refresh bypasses cache. Failed/null entries preserve previous values or unknown state—not zero. New address holders do not inherit stale deleted-account measurements.
14. With no first successful required measurement, new Drive additions pause while reads/cleanup remain. After six-hour expiry during outage, last known values remain usable and visibly stale. A partial unmeasured site inventory blocks site additions; Mail remains unrestricted.
15. Non–Suite Cloud keeps local onboarding/access and Drive quotas, with accurate Drive-only labels and no provider readiness lockout. Configuring Suite Cloud opts into configured-instance rules; dev mode does not bypass them.
16. Old dashboard/admin settings routes are gone without redirects; the unified dashboard retains all available administration capabilities and personal settings remain reachable.

These are release criteria, not assertions that tests have run or implementation is complete.
