# Suite codebase architecture

Status: Accepted for the Drive rewrite on 2026-09-05  
Scope: Python modules, Frappe integration, frontend modules, tests, and ownership  
Behavior source of truth:
[`wayfinder/drive-layer-spec/drive-layer-spec.md`](wayfinder/drive-layer-spec/drive-layer-spec.md)  
Implementation plan:
[`wayfinder/drive-layer-spec/drive-layer-plan.md`](wayfinder/drive-layer-spec/drive-layer-plan.md)

## Architecture in one sentence

Suite is a modular monolith: each product owns a deep module, products collaborate only through explicit interfaces, and Suite composition wires those modules together.

Drive is a foundational product module. It is not `suite_core`, a shared utility collection, or a database wrapper.

## Goals

- Give each product owner a clear area of responsibility.
- Keep cross-product dependencies visible, small, and acyclic.
- Put complete behavior behind small interfaces.
- Make the same interface the surface used by callers and tests.
- Prevent the Drive rewrite from reproducing today's coupling under new filenames.
- Let Mail, Calendar, Meet, Writer, Sheets, and Slides adopt the structure incrementally.

## Non-goals

- Splitting Suite back into separate Frappe apps or repositories.
- Refactoring every product before the Drive rewrite starts.
- Adding repository, port, or adapter layers where behavior does not vary.
- Moving code into `suite_core` merely because more than one product calls it.
- Reorganizing the entire frontend as part of the backend Drive rewrite.

## Module vocabulary

Use these terms consistently in design notes and reviews.

- **Module:** anything with one interface and an implementation.
- **Interface:** everything a caller must know to use a module correctly, including invariants, errors, ordering, configuration, and performance.
- **Implementation:** code hidden behind the interface.
- **Seam:** the location where a module's interface lives.
- **Adapter:** a concrete implementation attached at a seam.
- **Deep module:** a small interface that provides substantial behavior.
- **Locality:** a behavior, its invariants, and its tests change together in one place.

## Current structure

The repository is already one Frappe app and one frontend, but much of its internal structure still follows the former standalone apps.

```text
suite/
├── hooks.py                  # declarations plus cross-product wiring
├── api/                      # Suite-level endpoints
├── suite_core/
│   ├── boot.py               # also orchestrates product lifecycles
│   ├── doctype/
│   └── patches/
├── drive/
│   ├── api/                  # transport, workflows, and policy mixed
│   ├── doctype/              # persistence plus some behavior
│   ├── overrides/            # framework File replacement
│   ├── utils/                # storage, tree, users, and permissions
│   ├── webdav/               # protocol plus duplicated workflows
│   └── tests/
├── writer/                   # imports Drive API, overrides, and utils
├── sheets/                   # imports Drive override implementation
├── slides/                   # imports Drive permission and File internals
├── meet/                     # imports Drive quota and storage internals
├── mail/
└── calendar/

frontend/src/
├── apps/
│   ├── drive/                # directly calls some Writer/Sheets endpoints
│   ├── writer/
│   ├── sheets/
│   ├── slides/
│   ├── meet/
│   ├── mail/
│   └── calendar/
├── shell/
├── boot/
├── components/
├── composables/
├── stores/
└── utils/
```

The main problem is not the number of directories. It is that callers must know implementation details. A single Drive behavior often crosses `api`, `overrides`, `utils`, DocTypes, and WebDAV.

## Target structure

Keep the repository and Frappe app intact. Clarify composition, product interfaces, and internal implementation.

```text
suite/
├── hooks.py                         # declarative Frappe composition root
├── composition/
│   ├── lifecycle.py                 # install/migrate/boot ordering
│   └── registrations.py             # product adapters and hook registries
├── suite_core/                      # product-neutral Suite platform only
│   ├── doctype/
│   ├── identity/
│   ├── setup/
│   └── patches/
├── drive/
│   ├── __init__.py                  # public cross-product interface
│   ├── _core/                       # private Drive implementation
│   │   ├── roles.py
│   │   ├── principals.py
│   │   ├── access.py
│   │   ├── errors.py
│   │   ├── transactions.py           # ordered root locks and retries
│   │   ├── nodes.py
│   │   ├── upload.py
│   │   ├── quota.py
│   │   ├── versions.py
│   │   ├── previews.py
│   │   ├── comments.py
│   │   ├── activity.py
│   │   └── content.py
│   ├── framework.py                 # Frappe permission/query hook adapter
│   ├── jobs.py                      # Frappe scheduler adapter
│   ├── http/                        # HTTP adapter into Drive workflows
│   ├── webdav/                      # WebDAV adapter into Drive workflows
│   ├── doctype/                     # persistence implementation
│   ├── patches/                     # Build migration, later Cleanup
│   └── tests/                       # interface and adapter behavior
├── writer/
│   └── drive.py                     # Writer content adapter
├── sheets/
│   └── drive.py                     # Sheets content adapter
├── slides/
│   └── drive.py                     # Slides content adapter
├── meet/                            # calls Drive for artifacts/reservations
├── mail/
└── calendar/

frontend/src/
├── composition/
│   ├── appRegistry.ts
│   └── routes.ts
├── shell/                           # launcher, navigation, onboarding
├── platform/                        # product-neutral auth/network/theme/UI
└── apps/
    ├── drive/
    │   ├── index.ts                 # public cross-product interface
    │   ├── pages/
    │   ├── features/
    │   └── internal/
    ├── writer/
    ├── sheets/
    ├── slides/
    ├── meet/
    ├── mail/
    └── calendar/
```

This is a target shape, not a requirement to move every existing file immediately. New and rewritten code follows it; untouched products migrate when their owners work in the relevant area.

## Dependency direction

Arrows mean “may depend on.”

```text
Suite composition ───────────────────────────────▶ every product adapter

Writer ─┐
Sheets ─┼──▶ Drive interface ──▶ Drive implementation ──▶ Drive DocTypes
Slides ─┤                         │                └▶ frappe.storage
Meet ───┘                         │
                                  └──▶ Content Type interface
                                          ▲
                               Writer / Sheets / Slides adapters

Every product ──▶ suite_core
suite_core ──X──▶ product implementations
Drive implementation ──X──▶ Writer / Sheets / Slides implementations
```

The Content Type interface is a real seam because Writer, Sheets, and Slides provide different adapters. The Frappe database does not need a Drive-owned repository interface: there is one in-process implementation and the Frappe test site is the local substitute.

## Drive interface

The `suite.drive` package root is the only supported Python interface for code outside Drive. Its public names live in `suite/drive/__init__.py`. Product callers use `from suite import drive`.

Constants, contract types, and documented errors may be re-exported. Workflow
functions are a facade: they collect caller context, delegate to `_core`, and
return the documented result. Callers never construct internal principals or
compose partial steps.

`suite/drive/_core/` is private. Drive-owned adapters may call it directly. Frappe dotted hook targets terminate in `suite/drive/framework.py` or `suite/drive/jobs.py`, not in `_core`, so the framework boundary remains explicit.

The package exports complete workflows needed by real cross-product callers. Candidate capabilities are:

- resolve/check access to a node;
- create a document or file node;
- copy a node;
- touch a content document;
- take a version;
- create, grow, consume, and release a storage reservation;
- resolve a caller's Personal Root;
- declare a `ContentTypeSpec` and `Satellite`;
- catch documented Drive errors and use the exported Drive role values.

The final exported names must be derived from the production caller inventory. Do not export an operation merely because an internal test uses it.

The following remain private implementation details:

- quota admission and counter release;
- activity row creation;
- preview rendering and sweeps;
- grant query predicates;
- raw permission `require` helpers;
- DocType controllers and database queries;
- HTTP and WebDAV parsing;
- blob keys and storage-driver details.

### Allowed

```python
from suite import drive

node = drive.create_document(
    content_type="writer",
    parent=parent,
    title=title,
)
drive.touch("Writer Document", document_name)
```

The caller requests a complete outcome. Drive owns permission checks, quota, activity, identity links, and transaction ordering.

### Temporary compatibility

Legacy endpoint adapters translate old requests and responses into new workflows.
Drive adapters stay in `suite/drive/http/shims.py`. Product adapters stay at their
old endpoint locations and call the public `suite.drive` interface.
New workflows MUST NOT import legacy adapters, branch on legacy clients, or mirror legacy data.
Temporary adapters and their obsolete contract tests leave together after frontend adoption.
Permanent legacy names remain narrow adapters. The spec §11.7 owns their inventory.

Implementation stages are not separate production releases. Build, backend activation,
and a compatible frontend ship together after migration and restore rehearsals.

### Forbidden

```python
from suite.drive._core.quota import admit
from suite.drive._core.nodes import insert_node
from suite.drive.doctype.drive_node.drive_node import DriveNode

admit(root, size)
insert_node(values)
```

The caller can assemble an invalid partial workflow and must understand Drive's implementation.

## Meta codebase rules

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

### 1. Ownership and placement

1. Product behavior MUST live under the product that owns its domain language.
2. `suite_core` MUST contain only product-neutral Suite capabilities.
3. Cross-product orchestration MUST live in `suite/composition`, not in `suite_core` or an arbitrary product.
4. An adapter that teaches Drive about a product MUST live with that product, such as `writer/drive.py`.
5. A file MUST have one primary reason to change and one owning team.

### 2. Dependency direction

1. Product modules MUST NOT import another product's implementation.
2. Cross-product calls MUST use the provider's declared public interface.
3. Product dependency cycles MUST NOT be introduced.
4. Drive MUST NOT import Writer, Sheets, or Slides implementations. Suite composition registers their adapters through the Drive-owned Content Type interface.
5. `suite_core` MUST NOT import product implementations.
6. Dynamic imports and Frappe hook strings MUST follow the same dependency rules as static imports.

### 3. Interfaces and depth

1. A module MUST have one intentional interface.
2. Public interfaces MUST expose workflows, not database primitives or steps from a workflow.
3. Callers MUST NOT repeat invariants that belong to the called module.
4. A new public operation MUST have a known production caller.
5. Interface parameters and results SHOULD use domain language, not storage columns or transport shapes.
6. Errors, transaction behavior, permission requirements, and performance constraints are part of the interface and MUST be documented.
7. Re-exporting a name does not make a shallow wrapper deep; the implementation behind the interface MUST own meaningful behavior.

### 4. Seams and adapters

1. Introduce a seam only when behavior genuinely varies or a remote/external dependency requires one.
2. A proposed seam SHOULD have at least two justified adapters.
3. HTTP and WebDAV are adapters into the same Drive workflows; they MUST NOT own Drive policy.
4. Writer, Sheets, and Slides are adapters for the Content Type interface; Drive MUST NOT special-case their DocTypes in node workflows.
5. Internal test substitution MUST NOT leak internal seams into the public interface.

### 5. State and invariants

1. Each fact MUST have one source of truth.
2. Drive owns node title, location, grants, lifecycle, versions, comments, and Drive usage.
3. A content product owns its document body and editor-specific live state.
4. A state-changing public operation MUST leave permissions, quota, activity, references, and related records consistent in one transaction or a documented resumable process.
5. Transport adapters and callers MUST NOT write Drive tables directly.
6. DocType controllers SHOULD enforce persistence-local validation; multi-record product workflows belong in Drive's implementation.

### 6. Shared code

1. Code MUST remain in its product until at least two real consumers need the same behavior.
2. Shared code MUST use product-neutral language and have a clear owner.
3. `utils`, `common`, `helpers`, and `shared` MUST NOT be used as ownership-free dumping grounds.
4. Similar-looking code SHOULD remain duplicated when the underlying domain rules differ.
5. A shared extraction MUST reduce what callers need to know; moving code without hiding complexity is not an architectural improvement.

### 7. Testing

1. The module interface is the primary test surface.
2. Tests MUST assert observable outcomes, documented errors, and invariants through the same interface callers use.
3. HTTP and WebDAV adapter tests MUST verify translation and protocol behavior; Drive policy is tested through the Drive interface.
4. Internal tests MAY cover complex algorithms such as nearest-grant resolution or subtree path rewrites.
5. Tests MUST NOT require a public seam solely to reach private implementation.
6. When interface tests replace tests of shallow legacy modules, the legacy tests SHOULD be deleted rather than layered indefinitely.
7. Migration tests MUST prove reruns, partial progress, and failure safety.

### 8. Frontend modules

1. `frontend/src/apps/<product>` owns that product's UI and client behavior.
2. One frontend product MUST NOT import another product's pages, state, components, or internal utilities.
3. Cross-product frontend use MUST go through a declared lightweight interface such as `@/apps/drive`, exported by `apps/drive/index.ts`.
4. The Suite shell and composition modules MAY depend on product route declarations; product routes MUST NOT depend on the shell implementation.
5. Code enters `platform` only when it is product-neutral and has multiple consumers.
6. The Drive UI MUST create Writer/Sheets/Slides documents through the generic Drive document workflow, not product-specific endpoints.

### 9. Ownership and review

1. Product owners own files under their product.
2. The Suite architecture owner owns `suite/composition`, `suite_core`, the frontend shell/platform, and architecture enforcement.
3. A public interface change requires review from the provider owner and at least one affected consumer owner.
4. A cross-product data ownership change requires an update to `CONTEXT-MAP.md` before implementation.
5. Intentional dependency exceptions MUST be recorded with an owner, reason, and removal or review condition.

### 10. Architecture documentation

1. `ARCHITECTURE.md` owns module placement, dependency direction, and public-interface rules.
2. A product spec owns behavior; its implementation plan owns sequencing and file ownership. Neither may silently redefine the other.
3. A change to a public import path, target directory, hook target, or adapter location MUST update the charter, affected context maps, spec, plan, and decision records in the same change.
4. Design inputs and file references needed to implement a spec MUST live in this repository and use repository-relative Markdown links.
5. An external URL or machine-specific filesystem path MUST NOT be the only source of an architectural decision.
6. Historical alternatives MAY remain, but they MUST be labeled as historical or rejected and link to the accepted local authority.

## Automated enforcement

The rules should fail in CI, not depend on memory.

### Python import policy

Add `suite/tests/test_architecture.py` using Python's AST. It should reject:

- imports from `suite.drive._core`, `suite.drive.doctype`, `suite.drive.http`, or `suite.drive.webdav` outside `suite.drive`;
- imports from one product's internal packages by another product;
- product imports from `suite_core`;
- concrete content-product imports from Drive;
- unapproved cross-product imports not targeting a declared public interface.

Start with an explicit allowlist of existing debt. New violations fail; debt entries are removed as products migrate.

### Frontend import policy

Add an import-boundary check that rejects imports from `@/apps/<other-product>/...`, except declared package interfaces such as `@/apps/drive`.

Again, baseline existing debt and prevent growth before requiring immediate cleanup.

### Public interface contract

Add tests that enumerate `suite.drive.__all__` and reject accidental exports. Add contract tests for every registered Content Type adapter.

## Change checklist

Every significant change answers these questions in its issue or review:

1. Which product owns this behavior and vocabulary?
2. What is the module and where does its interface live?
3. Does the caller request a complete outcome or assemble internal steps?
4. Which invariants does the implementation hide?
5. Does this add a dependency edge or cycle?
6. If it adds a seam, which two adapters justify it?
7. Can the behavior be tested through the caller-facing interface?
8. Is shared code backed by multiple real consumers and a clear owner?
9. Does a data ownership or context relationship need documentation?
10. Can an architecture rule enforce the decision automatically?

## Adoption sequence

1. Keep this accepted charter, the Drive spec, and the Drive plan synchronized.
2. Add architecture tests with a baseline allowlist for existing debt.
3. Inventory production imports into Drive and freeze the minimal `suite.drive` exports.
4. Move lifecycle orchestration out of `suite_core` when the Drive installation hooks are changed.
5. Build the new Drive implementation behind its public interface.
6. Adopt Writer, Sheets, Slides, Meet, and Mail one adapter at a time.
7. Replace old interface tests as each legacy path is removed.
8. Apply the same module/interface exercise to Mail and Calendar next, where a dependency cycle already exists.

## Drive rewrite entry criteria

Begin implementation only when all of these are true:

- the supported Drive Python import path is decided;
- the initial exported operation list is written from real callers;
- the Content Type adapter interface is fixed;
- allowed dependency directions are recorded;
- architecture enforcement has a named owner and implementation stage;
- Drive behavior remains sourced from the existing Drive layer spec;
- frontend adoption is explicitly staged rather than hidden inside backend work.

## Decision

Accepted: the `suite.drive` package root is the only supported cross-product Python interface. Its implementation modules stay private, and the boundary is enforced before Stage 1 of the Drive rewrite. The preferred import is `from suite import drive`.
