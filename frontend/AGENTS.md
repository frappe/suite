# Frontend

- Follow the Frontend section of `../STANDARDS.md`.
- Use Frappe UI components and semantic design tokens. For UI implementation, use the `frappe-ui` skill; check APIs against the dependency pinned in `../package.json`.
- The root `frappe-ui/` checkout is not necessarily the installed dependency. Normal `dev` uses the installed package; `dev:frappe-ui` explicitly links the local checkout.
- Install with `pnpm install` at the repo root. Do not use Yarn or npm.
- Run frontend commands from the repo root. The tooling config (`vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `scripts/`, `baselines/`) lives there too.
- Run focused frontend tests with `pnpm test <test-file>`.
- Before handing work over, run `pnpm format`, `pnpm lint`, `pnpm check:untranslated` and `pnpm typecheck`. CI runs the same commands.
- A check that prints "Resolved ... debt still in the baseline" means you removed debt: rerun it with `--update-baseline` and commit the shrunk file under `baselines/`. Never add an entry to a baseline; fix the finding instead.
- After a route table changes on the backend, run `pnpm generate:contract` and commit `generated.ts` with `contract.json`.

- For ordinary API work, read `../wayfinder/suite-api-client/suite-api-client-spec.md`. Use generated `@/api` references. Add backend contracts before adding callers.
- Put scope and mutation effects in the owner policy. Keep policies and validators lazy. Do not add descriptor factories, ordinary raw requests, or `createResource` callers.
- After API changes, run `pnpm check:contract`, `pnpm check:import-boundaries`, and the shared-client behavior and effect coverage tests.
