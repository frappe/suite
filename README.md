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

<details>
<summary>View screenshots</summary>

### Drive

![Frappe Drive](https://github.com/user-attachments/assets/8b4b33ad-afb4-4e64-ac10-987076c66d57)

### Slides

![Frappe Slides](https://github.com/user-attachments/assets/3bb8ba8c-a5a1-4223-bf04-cd07372128a0)

### Meet

![Frappe Meet](https://github.com/user-attachments/assets/aa124052-dc35-4f0d-b974-d47d2d813e70)

### Mail

![Frappe Mail](https://raw.githubusercontent.com/frappe/mail/develop/docs/screenshots/ui/reading-pane-dark.png)

</details>

## Under the Hood

- [**Frappe Framework**](https://github.com/frappe/frappe): Provides the database, authentication, permissions, realtime events, and APIs shared by Drive, Writer, Sheets, Slides, Meet, Mail, and Calendar.
- [**Frappe UI**](https://github.com/frappe/frappe-ui): Power the interface and reusable components across every Suite product.
- [**Yjs**](https://github.com/yjs/yjs): Keeps documents in Writer and spreadsheets in Sheets synchronized during realtime collaboration.
- [**Hocuspocus**](https://github.com/ueberdosis/hocuspocus): Runs the collaboration server used for realtime spreadsheet editing in Sheets.
- [**mediasoup**](https://github.com/versatica/mediasoup): Powers Meet's WebRTC selective forwarding unit for group video calls.

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
