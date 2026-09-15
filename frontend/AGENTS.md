# Frontend

- Use Frappe UI components and semantic design tokens. For UI implementation, use the `frappe-ui` skill; check APIs against the dependency pinned in `package.json`.
- The root `frappe-ui/` checkout is not necessarily the installed dependency. Normal `dev` uses the installed package; `dev:frappe-ui` explicitly links the local checkout.
- Run focused frontend tests from this directory with `yarn test <test-file>`.
