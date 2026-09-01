# Stalwart for mail/calendar integration tests

The backend tests in `suite/mail/tests/` and `suite/calendar/tests/` run against a live
Stalwart server. Test classes skip themselves when Stalwart is not configured, so a
plain `bench run-tests --app suite` stays green without it.

## Start Stalwart

```sh
cd apps/suite/suite/mail/tests/docker
echo "127.0.0.1 mail.example.test" | sudo tee -a /etc/hosts  # once
./start-stalwart.sh
```

The JMAP session advertises URLs at `https://mail.example.test` (the bootstrap
`serverHostname`), so that name must resolve to the container and its TLS listener is
published on 443 (self-signed; the tests run with `verify_ssl: 0`).

This boots `stalwartlabs/stalwart` on `http://127.0.0.1:8080` with recovery admin
`admin:admin`, applies `bootstrap.ndjson` through `stalwart-cli` (downloaded on the
fly), and restarts the container — the same sequence the production deploy playbook
performs. Override with `STALWART_VERSION`, `STALWART_CLI_VERSION`,
`STALWART_ADMIN_USER`, `STALWART_ADMIN_PASSWORD`, or `STALWART_HTTP_PORT`.

## Point the site at it

```sh
bench --site <site> set-config allow_tests true
bench --site <site> set-config mute_emails 1  # unless the site has an outgoing Email Account
bench --site <site> set-config mail "{'server_url': 'http://127.0.0.1:8080', 'username': 'admin', 'password': 'admin', 'verify_ssl': 0}" --parse
bench --site <site> execute frappe.db.set_single_value --args "['Mail Settings', 'verify_ssl', 0]"
bench --site <site> clear-cache
```

(`Mail Settings` takes priority over `site_config.json` — leave its Stalwart fields empty
on test sites. `verify_ssl` must be unchecked there explicitly because the field defaults
to on, which would shadow the site_config value; the container's certificate is
self-signed.)

## Run the tests

```sh
bench --site <site> run-tests --app suite --module suite.mail.tests.test_admin_members
```

Test data uses unique per-run names, so repeated runs against the same container are
fine. For a full reset:

```sh
docker compose down -v && ./start-stalwart.sh
```
