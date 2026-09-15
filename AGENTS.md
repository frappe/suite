# Suite

Frappe app with a Vue frontend and separate realtime services.

- Prefer deep modules. For module design or refactoring, use the `improve-codebase-architecture` skill.
- Test observable behavior against independent expectations, not implementation details or assertions derived from the code under test.
- Load only context relevant to the task; don't read whole documentation trees.

## Context

- Frontend work: `frontend/AGENTS.md`. Python backend work: `suite/AGENTS.md`.
- For app behavior changes, read relevant specs under `specs/<app>/`, domain context at `suite/<app>/CONTEXT.md`, and decisions under `suite/<app>/docs/adr/`, where present.
