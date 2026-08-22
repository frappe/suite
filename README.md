<div align="center" markdown="1">

<img src="frontend/public/logo.svg" alt="Frappe Suite logo" width="80" height="80" />
<h1>Frappe Suite</h1>

**Original, intentionally designed productivity tools**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](license.txt)
[![Tests](https://img.shields.io/github/actions/workflow/status/frappe/suite/suite-ci.yml?branch=develop&label=Tests)](https://github.com/frappe/suite/actions/workflows/suite-ci.yml)

</div>

<div align="center">
  <img width="1990" height="966" alt="image" src="https://github.com/user-attachments/assets/462b2529-d8f8-4346-835b-b5c390bc6d57" />
</div>

<br />

<div align="center">
  <a href="https://frappe.io">Website</a>
  ·
  <a href="https://docs.frappe.io">Documentation</a>
  ·
  <a href="https://discuss.frappe.io">Forum</a>
</div>

## Frappe Suite

Frappe Suite brings seven collaboration products into one Frappe app. Keep files, documents, spreadsheets, presentations, meetings, email, and calendars in one connected workspace.

| Product | What it does |
| --- | --- |
| [Drive](https://github.com/frappe/drive) | Store, organize, share, and preview files |
| [Writer](https://github.com/frappe/writer) | Create and collaborate on documents |
| [Sheets](https://github.com/frappe/sheets) | Build collaborative spreadsheets |
| [Slides](https://github.com/frappe/slides) | Create and present slide decks |
| [Meet](https://github.com/frappe/meet) | Run video meetings |
| [Mail](https://github.com/frappe/mail) | Manage email in a modern client |
| [Calendar](https://github.com/frappe/calendar_app) | Plan events and manage schedules |

## Under the Hood

- [**Frappe Framework**](https://github.com/frappe/frappe): Provides the database, authentication, permissions, realtime events, and APIs shared by Drive, Writer, Sheets, Slides, Meet, Mail, and Calendar.
- [**Frappe UI**](https://github.com/frappe/frappe-ui): Power the interface and reusable components across every Suite product.
- [**Yjs**](https://github.com/yjs/yjs): Keeps documents in Writer and spreadsheets in Sheets synchronized during realtime collaboration.
- [**Hocuspocus**](https://github.com/ueberdosis/hocuspocus): Runs the collaboration server used for realtime spreadsheet editing in Sheets.
- [**mediasoup**](https://github.com/versatica/mediasoup): Powers Meet's WebRTC selective forwarding unit for group video calls.

## Migrating from the Standalone Apps

Frappe Suite ships the same modules and DocTypes as the standalone apps, so it cannot be installed on a site that still has any of them — installation aborts with a message listing the conflicting apps. To move an existing site to Suite:

1. **Take a backup of the site**, including files.
2. **Uninstall all the standalone apps** (Drive, Writer, Sheets, Slides, Meet, Mail, Calendar). Uninstalling deletes each app's data on the site, which is why the backup comes first.
3. **Install Frappe Suite.**
4. **Restore the backup.** Suite uses the same tables, so the restored data is picked up as-is.

The same steps apply to sites hosted on [Frappe Cloud](https://frappecloud.com): download a backup from the site dashboard (**Backups**), remove the standalone apps from the **Apps** tab, install Frappe Suite, and then restore the backup from **Backups → Restore**.

### Migrating with bench

```bash
# 1. Back up the site along with its public and private files
bench --site yoursite backup --with-files

# 2. Uninstall every standalone app present on the site
#    (run only the lines for the apps your site actually has)
bench --site yoursite uninstall-app drive
bench --site yoursite uninstall-app writer
bench --site yoursite uninstall-app sheets
bench --site yoursite uninstall-app slides
bench --site yoursite uninstall-app meet
bench --site yoursite uninstall-app mail
bench --site yoursite uninstall-app calendar_app

# 3. Install Frappe Suite
bench get-app https://github.com/frappe/suite
bench --site yoursite install-app suite

# 4. Restore the backup taken in step 1
bench --site yoursite restore sites/yoursite/private/backups/<timestamp>-database.sql.gz \
	--with-public-files sites/yoursite/private/backups/<timestamp>-files.tar \
	--with-private-files sites/yoursite/private/backups/<timestamp>-private-files.tar
```

The restored database still lists the standalone apps as installed, so point the site at Suite and migrate:

```bash
bench --site yoursite remove-from-installed-apps drive
bench --site yoursite remove-from-installed-apps writer
bench --site yoursite remove-from-installed-apps sheets
bench --site yoursite remove-from-installed-apps slides
bench --site yoursite remove-from-installed-apps meet
bench --site yoursite remove-from-installed-apps mail
bench --site yoursite remove-from-installed-apps calendar_app
bench --site yoursite install-app suite
bench --site yoursite migrate
```

## Development Setup

Install [Bench](https://github.com/frappe/bench) and create a Frappe site by following the [Frappe Framework installation guide](https://docs.frappe.io/framework/user/en/installation).

From your bench directory, get and install Suite:

```bash
bench get-app https://github.com/frappe/suite
bench new-site suite.localhost --install-app suite
bench start
```

In a separate terminal, install frontend dependencies and start the development server:

```bash
cd apps/suite
yarn install
yarn dev
```

To create a production build instead:

```bash
bench build --app suite
```

#### Meet SFU

Meet requires a separate mediasoup SFU server for video calls. Follow the [Frappe Meet SFU setup guide](suite/meet/sfu-server/README.md) to configure and run it.

## Contributing

Contributions are welcome. Please open an issue to report a bug or propose a change before submitting a pull request.

- [Report an issue](https://github.com/frappe/suite/issues)
- [Report a security vulnerability](https://frappe.io/security)
- [Frappe contribution guidelines](https://github.com/frappe/erpnext/wiki/Contribution-Guidelines)

## License

Frappe Suite is licensed under the [GNU Affero General Public License v3](license.txt).

<br />

<div align="center">
  <a href="https://frappe.io" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/Frappe-white.png">
      <img src="https://frappe.io/files/Frappe-black.png" alt="Frappe Technologies" height="28" />
    </picture>
  </a>
</div>
