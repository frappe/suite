# Domain Docs

App documentation applies across its frontend, Python backend, and supporting services.

## Find Relevant Context

- Specs live at `specs/<app>/<NNN>-<slug>.md`; see `specs/README.md` when writing one.
- Existing domain vocabulary lives in `suite/<app>/CONTEXT.md` (currently Meet and Drive).
- Existing decisions live under `suite/<app>/docs/adr/` where present.
- Select documents by the behavior being changed. Read relevant sections, not every spec or ADR for an app. Skip absent locations.

## Use The Glossary

Use the affected app's documented terms in code, specs, issues, and tests. Keep each concept's definition in one place and link to it rather than copying it across frontend and backend docs.

## Current Contracts

Check document status: proposals and research are not accepted contracts. Surface conflicts with accepted specs or ADRs rather than silently overriding them. An accepted spec may describe work not yet implemented; verify current behavior in code.
