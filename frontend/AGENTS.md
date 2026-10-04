# Frontend

- Follow the Frontend section of `../STANDARDS.md`.
- Use Frappe UI components and semantic design tokens. For UI implementation, use the `frappe-ui` skill; check APIs against the dependency pinned in `package.json`.
- The root `frappe-ui/` checkout is not necessarily the installed dependency. Normal `dev` uses the installed package; `dev:frappe-ui` explicitly links the local checkout.
- Run focused frontend tests from this directory with `yarn test <test-file>`.
- Before handing work over, run `yarn format`, `yarn lint`, `yarn check:untranslated` and `yarn typecheck` from this directory. CI runs the same commands.
- A check that prints "Resolved ... debt still in the baseline" means you removed debt: rerun it with `--update-baseline` and commit the shrunk file under `baselines/`. Never add an entry to a baseline; fix the finding instead.
- After a route table changes on the backend, run `yarn generate:contract` here and commit `generated.ts` with `contract.json`.
