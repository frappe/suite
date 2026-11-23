# Building & releasing

> **Note:** In the `suite` monorepo the Sheets frontend is part of the unified
> `frontend/` SPA, which builds to `suite/public/frontend` (served at
> `/assets/suite/frontend/`). The standalone per-app build described below is
> superseded by that shared build — see `frontend/` for the current workflow.

Frappe Cloud does **not** run `npm install` or `npm run build` for this app.
The pre-built frontend assets need to be in
`suite/public/frontend/` before every push that
includes frontend changes.

## Local release workflow

```bash
pnpm install           # first time only / after package.json changes
pnpm build             # writes to suite/public/frontend/

# Sanity check — these should all exist:
ls suite/public/frontend/
#   index.html  index.js  index.css  Inter.var.woff2  Inter-Italic.var.woff2  ...

# Commit the rebuilt assets alongside any source changes:
git add suite/public/frontend/
git commit -m "build: rebuild frontend assets"
git push
```

Frappe Cloud picks up the new commit and serves those files via the
`/assets/suite/frontend/` URL prefix.

## Why pre-built?

Wiring Frappe Cloud to run Node during install is a larger lift (custom
build hook, longer cold-start, build failures during deploy). Pre-built
assets are slower for the repo but make every Cloud deploy deterministic.

When the project warrants it, the post-launch fix is a `before_app_install`
hook in `pyproject.toml` that runs `npm ci && npm run build`.
