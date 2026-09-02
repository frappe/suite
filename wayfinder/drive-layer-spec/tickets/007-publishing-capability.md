---
id: 007
title: Publishing capability
label: wayfinder:grilling
status: open
assignee:
blocked-by: [002]
---

## Question

Slides force-inserts an anyone-with-link permission row on every save of a
composite deck, bypassing the grant ceiling, because the saver may lack
share rights. Decide how programmatic publishing works in the new model:
publish is MANAGE-only, or a distinct app-granted capability, or an
explicit SDK call with its own permission rule. Include unpublish and the
audit trail.

Red-team walkthrough: scenario S7. Blocked by Role ladder semantics.
