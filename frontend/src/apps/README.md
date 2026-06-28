# Working On A Suite App

Frappe Suite uses **one unified Vue 3 SPA** (`apps/suite/frontend`). This guide
orients you so you can make changes safely within a product area.

> Your commit history is intact: `git log --follow` / `git blame` on a file under
> `src/apps/<your-app>/` reaches the original authors (grafted from the source repo).

## Where your app lives

```
apps/suite/frontend/
  src/
    main.ts            # ONE app bootstrap (shared) — do not edit per-app
    App.vue            # SuiteLayout + <router-view>
    router/index.ts    # ONE router; lazy-loads each app's routes.ts under its prefix
    boot/              # shared: session.ts (auth), config.ts (frappe-ui), translation.ts (__())
    shell/             # launcher (/suite), AppContainer, SuiteLayout, NotFound
    stores/            # shared root/session Pinia stores
    apps/
      <your-app>/      # >>> YOUR CODE LIVES HERE <<<
        routes.ts      # entry: exports `routes` (relative to your prefix), lazy-loaded
        router.ts      # (most apps) a prefix-scoped navigation guard on the shared router
        views/         # route-level pages (was usually pages/)
        components/ composables/ stores/ utils/ ...
```

Each app owns its original URL **prefix**: `/drive /slides /writer /sheets /meet
/mail /calendar`. The launcher is at `/suite`. The router lazy-loads
`src/apps/<app>/routes.ts` on first navigation into the prefix, so heavy app deps
stay code-split.

## How to run

Dev site: **`suite.localhost:8004`** (bench/mprocs-managed). The SPA serves every
app prefix.

```bash
# build the whole suite SPA (gate: must exit 0)
cd apps/suite/frontend && yarn build
# or via bench
bench build --app suite
```

- **Route rules need a backend restart:** `website_route_rules` map every prefix to
  the SPA. After pulling, **restart `frappe serve`** or `/drive`, `/mail`, etc. will
  404 until the rules reload (`/suite` works without it).
- Log in once, then open your app at `suite.localhost:8004/<your-prefix>`.
## Conventions your changes must follow

The foundation (router, shell, build, shared boot) is **shared infrastructure**.
Keep your work inside `src/apps/<your-app>/`.

- **Do NOT edit** `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`,
  `tsconfig*`, `src/main.ts`, `src/router/index.ts`, `src/boot/*`, `src/shell/*`,
  `src/stores/*`, `src/apps/registry.ts`, `src/env.d.ts`, or another app's folder.
  If you genuinely need a foundation change, raise it — don't work around it.
- **Routes:** export `routes: RouteRecordRaw[]` (+ default) from `routes.ts`, paths
  **relative** to your prefix (no leading slash; `''` = index). Namespace route
  names `<app>-*`. Keep views lazy (`() => import('@/apps/<app>/views/Foo.vue')`).
  Don't create your own `createRouter`/`createWebHistory` — the suite router mounts
  your `routes` under your prefix. Per-app nav guards attach to the shared router
  and must early-return for routes outside your prefix (see your `router.ts`).
- **Auth:** the shared router redirects guests to `/login`. Public/guest-reachable
  routes must set `meta: { isPublic: true }`. Use `useSessionStore` from
  `@/boot/session` for login state — not a per-app session store.
- **frappe-ui:** pinned to **`1.0.0-beta.9`**, imported bare (`import { ... } from
  'frappe-ui'`). Resources via `createResource`/`createListResource`/`call`.
- **Design tokens:** one shared Tailwind config. The beta token classes
  `bg-surface-*` / `text-ink-*` / `border-outline-*` are valid in markup but
  **cannot be `@apply`-ed** (build error). Don't add a per-app Tailwind/PostCSS config.
- **Pinia store ids** must be namespaced `<app>-*` (single shared Pinia instance —
  bare ids like `'user'`/`'chat'` collide across apps).
- **Translation:** bare `__('text')` works globally (foundation `boot/translation.ts`).
  Apps populate `window.translatedMessages` themselves on module load.

## Backend calls

Use the `suite.*` namespace for product backend calls, e.g.
`suite.drive.api.files.*`, `suite.client.doctype.*`, `suite.slides.doctype.*`, and
`suite.calendar.api.*`. Framework `frappe.*` paths are unchanged.
