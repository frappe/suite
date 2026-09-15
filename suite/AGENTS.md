# Python Backend

These rules apply to Python/Frappe code, not the Node services nested here.

- Enforce business validation and permissions on the server. Don't fix workflows by bypassing permission checks.
- Don't commit transactions inside document events.
- Test permission-sensitive behavior as a normal user, not only Administrator.
- Run Frappe tests from the bench directory with `bench --site <test-site> run-tests --module <dotted.test.module>`; they require an installed Suite test site.
