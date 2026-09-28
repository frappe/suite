---
id: 017
title: Product methods and the zero-call gate
label: wayfinder:grilling
status: open
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014 gates flip 2 on "zero legacy `suite.drive.api.*` calls" in new
code, and gates deletion on a legacy-call counter at zero. Drive §11.7 keeps
the 19 `suite.drive.api.product` methods on `/api/method/` by design. The
Files settings tabs from ticket 016 call some of them today
(`webdav_config`, `set_webdav_enabled`, `disk_settings`, `is_site_admin`),
and Statistics calls `storage.storage_breakdown`. Read literally, the
counter never reaches zero and deletion never happens. Drive §14.10 adds a
conflict: it deletes "the 69 API forwarders except the three permanent
names", and the 69 include the product methods.

Decide:

- Which names the boundary check bans in new code, and which names the
  counter (ask D26) must show at zero. Likely: only the names Drive §11.7
  maps to a REST route; the product methods and the three permanent names
  are exempt.
- Whether the Files settings tabs call product methods at launch or wait for
  `/api/suite/drive/` routes. That would be a new Drive ask.
- The Drive §11.7 against §14.10 conflict: an ask on the Drive program.
- The hold clock: if the counter shows a call during the hold, does the
  14-day period restart? Ticket 014 does not say.

Raised by the spec and plan audits of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).
