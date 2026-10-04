# Python Backend

These rules apply to Python/Frappe code, not the Node services nested here.

- Follow the Python backend section of `../STANDARDS.md`.
- Enforce business validation and permissions on the server. Don't fix workflows by bypassing permission checks.
- Don't commit transactions inside document events.
- Test permission-sensitive behavior as a normal user, not only Administrator.
- Run Frappe tests from the bench directory with `bench --site <test-site> run-tests --module <dotted.test.module>`; they require an installed Suite test site.
- `ruff check .` and `ruff format --check .` must pass; both fail CI. Run `mypy` from the app directory (`apps/suite`): a module absent from the `ignore_errors` list in `pyproject.toml` must stay clean, and a module you clean up leaves that list in the same change.
- After changing a route table in `http/translator.py`, run `bench --site <site> execute suite.composition.contract.write_all`, then `yarn generate:contract` in `frontend/`, and commit `contract.json` and `generated.ts`. CI fails on drift.
