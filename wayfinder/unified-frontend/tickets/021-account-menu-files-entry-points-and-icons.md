---
id: 021
title: Account menu, Files entry points and icons
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

Small surface decisions the spec cannot make from the tickets.

- **Upgrade plan.** Ticket 016 puts it in the avatar menu but leaves
  visibility for non-admins undecided.
- **Open Desk.** Ticket 016 shows it to system users. The session has only
  a `systemManager` capability. Add a `systemUser` capability, or show Open
  Desk to system managers only?
- **Folder upload and New from template.** Tickets 007 and 009 decide both
  flows. No ticket places their entry points in Files (New menu, drop, row
  menu).
- **Icon source.** The prototype and the current code use frappe-ui's
  lucide sprite. Faris's standing rule is the Figma set unless he says
  otherwise. The map deferred this to "the first styling ticket"; Stages 4,
  8, 9 and 10 style.

Raised by the spec and plan audits of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).
