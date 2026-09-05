# 34 — Adopt document media, grouped composites, and collab credentials

**What to build:** Open and edit content apps using Drive node media and scoped sharing credentials.

**Blocked by:** [33 — Make sharing actions and relevant link credentials explicit](33-frontend-sharing-and-links.md)

**Status:** ready-for-human

**Owner:** Suite frontend Writer, Slides, and Sheets

**Execution gate:** Part of the separate frontend adoption effort; execute after that scope is authorized.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.2, §6.6–6.8, §10–11; frontend follow-up.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Migrate Writer, Slides, and Sheets document creation, templates, copy, history, comments, and lifecycle callers.
- [ ] Replace old Slide attachment/media endpoints with node ids and signed media URLs.
- [ ] Refresh 15-minute media URLs at ten minutes. Preserve pinned caching with signature-free blob keys and the stated revocation window.
- [ ] Load composite references in groups within the 20-code cap, including the composite’s code when required.
- [ ] Preserve ordered unreadable placeholders and explicit group errors. Never omit references silently.
- [ ] Use only relevant document credentials for collaboration and reflect server read-only/refused states.
- [ ] Audit SPA, collaboration clients, pinned content, and generated bundle inputs for retired methods. Preserve the permanent compatibility names.

## Verification

Run content-app browser journeys with more than 20 separately shared decks, revocation between groups, media refresh, template creation, and collab downgrade.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
