# 20 — Load composite references in authorized groups

**What to build:** Load large composites without sending unrelated link codes or weakening reference authorization.

**Blocked by:** [18 — Move Slides documents and media into Drive](18-slides-adoption.md)

**Status:** ready-for-agent

**Owner:** Suite Slides API

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.2, §6.6; §11.2 composite route.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Define and document the Slides grouped-load request and response contract beside its adapter tests.
- [ ] Use stable reference identifiers and bounded requested groups. Validate membership in the composite; reject arbitrary injected references.
- [ ] Authorize the composite and each requested reference on every group. Count the composite’s own code within the 20-item cap.
- [ ] Return unreadable references explicitly in their requested order. Do not silently remove them or expose their content.
- [ ] Keep each group independently loadable after grant changes. Remembered client target associations confer no authority.
- [ ] Provide contract fixtures for frontend adoption, including more than 20 separately shared references.
- [ ] Keep this a Slides API operation. Add no generic Drive route or new permission rule.

## Verification

Run grouped-load tests for 19 references plus a composite code, multiple groups, unauthorized ids, revocation between groups, and stable placeholders.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
