# Issue Tracker: Local Markdown

Issues and PRDs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<effort-slug>/`.
- A PRD is `.scratch/<effort-slug>/PRD.md`.
- Implementation issues are `.scratch/<effort-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Triage state is recorded as a `Status:` field near the top of each issue file.
- Comments and conversation history append under `## Comments`.

## Publishing And Fetching

When a skill says to publish to the issue tracker, create a Markdown file under the relevant effort directory. When a skill says to fetch a ticket, read the referenced path; the path is the issue identity.

## Wayfinding Operations

A wayfinding effort uses this layout:

```text
.scratch/<effort-slug>/
|-- map.md
`-- tickets/
    |-- 01-<ticket-slug>.md
    `-- 02-<ticket-slug>.md
```

`map.md` is the parent issue and has `Label: wayfinder:map`. Each ticket is its child by carrying `Parent: ../map.md` and one `wayfinder:<type>` label.

Ticket metadata uses these fields before the body:

```text
Status: open
Assignee:
Label: wayfinder:research
Parent: ../map.md
Blocked by:
```

- Claim a ticket by setting `Assignee:` to the dev driving the map before doing any work. An empty assignee is unclaimed.
- Express blocking by listing ticket paths, comma-separated, in `Blocked by:`. An empty field means no blockers.
- A ticket is unblocked when every file in `Blocked by:` has `Status: closed`.
- The frontier is the numbered list of open, unassigned child tickets whose blockers are all closed.
- Record a resolution by appending a dated answer under `## Comments`, then set `Status: closed`.
- Use relative Markdown links from the map to tickets and between related tickets.
- Create all ticket files before adding their `Blocked by:` relationships.
