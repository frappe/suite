# Suite

Frappe app with a Vue frontend and separate realtime services.

- Prefer deep modules. For module design or refactoring, use the `improve-codebase-architecture` skill.
- Test observable behavior against independent expectations, not implementation details or assertions derived from the code under test.
- Load only context relevant to the task; don't read whole documentation trees.

## Context

- Frontend work: `frontend/AGENTS.md`. Python backend work: `suite/AGENTS.md`.
- App behavior or design, across frontend, backend, and services: `docs/agents/domain.md` routes to relevant context, decisions, and specs.

## Agent skills

- Issue or PRD work: issues live under `.scratch/`; see `docs/agents/issue-tracker.md`.
- Triage: use the vocabulary in `docs/agents/triage-labels.md`.
