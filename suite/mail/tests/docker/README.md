# Stalwart for mail/calendar integration tests

The backend tests in `suite/mail/tests/` and `suite/calendar/tests/` come in two kinds:

- **Directory tests** (`test_suite_cloud_directory.py`, `test_suite_cloud_client.py`) run against
  an in-memory Suite Cloud (`suite/mail/tests/fake_suite_cloud.py`) and need no server at all. A
  plain `bench run-tests --app suite` runs them.
- **Live tests** (everything built on `StalwartIntegrationTestCase` in `suite/mail/tests/base.py`)
  send and read real mail over JMAP. They need a Stalwart cluster **managed by a Suite Cloud** that
  knows this site, because accounts are created through Suite Cloud's site API. Test classes skip
  themselves when the site has no mail server configured, so the default run stays green.

## Live tests against a Suite Cloud

The simplest setup is one bench with both apps on the same site: install `suite_cloud`, register a
cluster and bootstrap a node as its README describes, create a Suite Site for this site (the desk
form or `suite_cloud.api.fc.create_site`), and point Mail Settings, or the `mail` site config, at
it:

```sh
bench --site <site> set-config allow_tests true
bench --site <site> set-config mute_emails 1  # unless the site has an outgoing Email Account
bench --site <site> set-config mail "{'server_url': 'https://mail.blr.frappemail.com', 'suite_cloud_url': 'http://<site>:8000', 'site_api_key': '<key>', 'site_api_secret': '<secret>', 'verify_ssl': 1}" --parse
bench --site <site> clear-cache
```

Mail Settings takes priority over `site_config.json`, so leave its Mail Server fields empty on a
test site. Test data uses unique per-run names, so repeated runs against the same cluster are fine;
cleanup is best-effort.

## A standalone Stalwart container

The compose file here boots a plain Stalwart for exploring JMAP by hand. It is not managed by a
Suite Cloud, so the live test classes above cannot create accounts on it.

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

## Run the tests

```sh
bench --site <site> run-tests --app suite --module suite.mail.tests.test_suite_cloud_directory
bench --site <site> run-tests --app suite --module suite.mail.tests.test_mail_flags_and_search  # live
```

For a full reset of the standalone container:

```sh
docker compose down -v && ./start-stalwart.sh
```
