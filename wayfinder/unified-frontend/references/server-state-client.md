# Server-state client: guideline

Status: guideline, not a spec. Decided in conversation on 2026-09-12 and
2026-09-13. Start Drive on it. Tighten rules as real pages land. Codex agents
inventoried Frappe, the Drive REST layer and the six app frontends; the facts
below cite that work.

Owner ticket: [002 Shell and platform interface](../tickets/002-shell-and-platform-interface.md).

## Purpose

One client layer for every Suite product's request and response data. It
replaces `createResource`, `useDoc`, `useList`, `useCall` and direct `call`.
It does not own live planes: Yjs documents, WebRTC media, SSE streams. Those
stay beside it.

## Facts it rests on

- Every Frappe document has a global identity `(doctype, name)` and a version
  `modified`. Drive list rows and detail fetches share one node shape.
- `doc_update` fires after commit with `{doctype, name, modified}` into
  `doc:{doctype}/{name}`. `list_update` fires `{doctype, name, user}` into
  `doctype:{doctype}` with no version. Room joins are permission-checked
  server side (`frappe/realtime/handlers.py`).
- v2 PATCH runs `check_if_latest`. Sending the cached `modified` gives
  conflict detection; omitting it disables the check. The conflict is HTTP
  417 `TimestampMismatchError`, so classify errors by `errors[0].type`, never
  by status.
- Drive uses cursor pages `{rows, next_cursor}`. Only `next_cursor: null`
  ends a list. A short page does not.
- Drive workflows emit no socket event today. Drive mutations accept no
  expected `modified`. Both are backend asks.
- Drive handler args must stay `Given`, because Frappe's argument check fires
  before Drive's error boundary (`routes.py:67-75`). Return annotations are
  free.
- Pages today pass the whole resource object as a prop and read `.data` and
  `.loading` on it. No destructuring, no Suspense. Mutations are declared once
  with their own error toast. Prefetch happens in `beforeEnter`.

## The canon: one way per job

- Read: `useQuery(descriptor)`.
- Write: `useMutation(descriptor)`. Always. Also outside components.
- Await a read outside a component: `useQuery(descriptor).settled()`.
- Errors are values in `.error`. `run` and `settled()` never reject.
  No try/catch in application code.
- Descriptors are inert values. Application code never sees a URL, a dotted
  Python path, a DocType string or a cache key.

Programmer errors still throw: a malformed descriptor or an input that fails
the generated validator throws at the `run` call. Swallowing a bug into
`.error` would hide it behind a toast.

## Layers

- `transport`: fetch, CSRF, v2 envelope, error decoding, abort, retry,
  `X-Drive-Links` selection. Calls every RPC through `/api/v2/method/...` so
  there is one envelope. v1 decoding exists only for legacy shims.
- `contract`: generated from Python. Operation ids, input and output
  validators, error unions, entity declarations.
- `engine`: entity store, query store, dedupe, stale-while-revalidate, focus
  and reconnect refetch, GC, paging, mutation queue, realtime bridge.
- `client`: per-product descriptor modules in `apps/<product>/client`.
- `vue`: `useQuery`, `useMutation` from `@/platform/server-state`.

Application code imports the last two only.

## Python contract

Two sources, one generator. Effects stay out of Python.

### REST resources (Drive): the route table

`ROUTES` in `translator.py` already lists verb, path and handler. Make each
row a dataclass and add `body` and `errors`. A path template replaces the
regex and the duplicated segment names. Outputs are `TypedDict` return
annotations on the handler and on the `shapes.py` serializers.

```py
class NodeShape(TypedDict):
    name: str
    title: str
    parent: str | None
    modified: str | None
    ...

class Page(TypedDict, Generic[T]):
    rows: list[T]
    next_cursor: str | None

class Rename(TypedDict):  title: str
class Move(TypedDict):    parent: str
class Trash(TypedDict):   state: Literal["Trashed"]
class Restore(TypedDict): state: Literal["Active"]; parent: NotRequired[str]

@dataclass(frozen=True)
class Route:
    method: str
    path: str
    handler: str
    body: type | None = None
    errors: tuple[type[DriveError], ...] = ()

ROUTES = (
    Route("PATCH", "nodes/{node}", "node_patch",
          body=Rename | Move | Trash | Restore | Stamp,
          errors=(DriveForbidden, DriveConflict)),
    Route("GET", "nodes/{node}/children", "node_children", body=ChildrenQuery),
    Route("PUT", "nodes/{node}/grants/{principal:path}", "node_put_grant", body=GrantPut),
)
```

A body union names the operations. The generator emits `api.node_patch.rename`,
`api.node_patch.move` and so on, one per union member. That is where
"capabilities in the type" comes from: `node.update` does not exist.

Existing route-table tests keep checking the table against the decorators.
Shape tests validate each serializer against its `TypedDict`.

### RPC methods (every other app): the function

Frappe already validates annotated inputs on whitelisted functions, so the
function is the contract. Signature in, return annotation out.

```py
class ThreadPage(TypedDict):
    threads: list[ThreadShape]
    mailbox: MailboxShape

@frappe.whitelist()
def get_threads(mailbox: str, start: int = 0, limit: int = 25) -> ThreadPage: ...
```

Operations with no return annotation generate with an unknown output. A
screen migration adds the annotation for the operations it touches. Cost
tracks what you migrate.

### Validation

Validate inputs always. Validate outputs in dev builds only.

## Client modules

One module per product resource. Flat functions return descriptors. Nesting
only for real sub-collections (`nodes.versions(id)`).

```ts
// apps/drive/client/nodes.ts
import { api } from './generated'
import { query, infinite, mutation, upload } from '@/platform/server-state'

export const nodes = {
  detail: (id: string, opts?: NodeGetOptions) => query(api.node_get, { node: id, ...opts }),
  children: (id: string, opts?: ChildrenOptions) =>
    infinite(api.node_children, { node: id, ...opts }, {
      member: (n) => n.parent === id && n.state === 'Active',
    }),
  versions: (id: string) => infinite(api.node_versions, { node: id }),
  threads: (id: string) => query(api.node_threads, { node: id }),
  grants: (id: string) => query(api.node_grants, { node: id }, { member: (g) => g.node === id }),

  rename: mutation(api.node_patch.rename, { optimistic: (i, n) => ({ ...n, title: i.title }) }),
  move: mutation(api.node_patch.move, { optimistic: (i, n) => ({ ...n, parent: i.parent }) }),
  trash: mutation(api.node_patch.trash, { optimistic: (i, n) => ({ ...n, state: 'Trashed' }) }),
  restore: mutation(api.node_patch.restore),
  moveMany: mutation(api.node_batch, { touches: (i) => i.nodes }),

  grant: mutation(api.node_put_grant),
  revoke: mutation(api.node_delete_grant),
  upload: upload(api.upload_create, api.upload_chunk, api.upload_finish),
}
```

Rules:

- `member` declares which entities belong to a list. The engine moves
  entities between lists on every write-through or optimistic patch and
  refetches in the background to fix order. Ordinary writes then need no
  invalidation code.
- Lists whose server filter the client cannot mirror (search) declare
  `invalidates` or rely on focus refetch.
- `touches` marks entities stale after a write whose response carries no
  shapes (batch).
- `optimistic` is the only per-mutation client logic.
- Product-neutral code goes to `platform/` only with two real consumers
  (ARCHITECTURE rule 8).

## Reading

`useQuery` returns a reactive object. Pass it as a prop, read fields on it.
A getter makes params reactive. Returning nothing disables the query.

```ts
const folder = useQuery(() => props.id && nodes.detail(props.id, { expand: ['breadcrumbs'] }))
// folder.data, folder.error, folder.status, folder.isFetching, folder.isStale, folder.refetch()

const children = useQuery(() => nodes.children(props.id, { orderBy: 'title' }))
// list descriptor: children.rows, children.hasNext, children.fetchNext(), children.isFetchingNext

const results = useQuery(() => term.value.trim() && views.search(term.value))
```

`status` is `pending`, `error` or `success`. Realtime, focus and reconnect
refetch are on for every query. `refetchInterval` covers polling.

Outside a component:

```ts
beforeEnter: async (to) => {
  const node = await useQuery(nodes.detail(to.params.id)).settled()
  if (node.error) return { name: 'files.not-found' }
  if (node.data.kind === 'folder') return { name: 'files.folder', params: to.params }
}
```

`settled()` resolves when the fetch is over either way, with the query object.
The engine garbage-collects unobserved queries by timeout.

## Writing

```ts
const rename = useMutation(nodes.rename, { silent: ['DriveConflict'] })
const taken = computed(() => rename.error?.type === 'DriveConflict')
const save = () => rename.run({ node: props.node.name, title: title.value })
```

- `run` resolves to the output on success or `undefined` on failure.
- `isPending`, `error`, `reset()` on the object. Upload descriptors add
  `progress` and `cancel()`.
- Mutations toast on error by default. `silent` is the one knob: `true` or a
  list of error types the caller handles itself. Queries never toast.
- Every mutation response is normalized into the entity store, so pages never
  refetch after a write.

```ts
const trash = useMutation(nodes.trash)
const restore = useMutation(nodes.restore)

async function onTrash(node: DriveNode) {
  if (!(await trash.run({ node: node.name }))) return
  toast({ title: `Moved "${node.title}" to trash`,
          action: { label: 'Undo', onClick: () => restore.run({ node: node.name }) } })
}
```

Challenges register once, outside components:

```ts
const unlock = useMutation(links.unlock, { silent: true })
serverState.onChallenge('DriveLocked', async (error, retry) => {
  const password = await askForPassword(error.link)
  const result = await unlock.run({ token: error.link, password })
  if (!result) return
  linkStore.attachTicket(error.link, result.ticket)
  return retry()
})
```

## Errors

- Generated `type` string-literal union per operation, from the Python error
  classes. `error.type === 'DriveConflict'` narrows.
- Base shape: `{ type, message, status }`.
- Retry only GETs, only on network and 5xx failures. Never on 4xx.
- `TimestampMismatchError`: refetch the entity, surface a conflict, never
  auto-retry.
- `SessionExpired`: pause all queries until login.
- `RateLimitExceededError` (429): respect retry-after.

## Cache model

Two stores.

- Entity store: `id -> {data, version, fetchedAt}`. Only outputs the contract
  tags as entities are normalized. Everything else stays raw.
- Query store: `operation + paramsHash -> {refs | raw, status, dataUpdatedAt, pages}`.
  Lists hold entity refs, so one write patches every list showing the entity.

Each entity declaration names its id field and its version field. Drive
nodes use `name` and `modified`. Sheets uses `head_seq`, Meet recordings use
`state_revision`, Mail threads use a synthetic name and no version. Freshness
by version applies wherever a version exists. Otherwise the engine falls back
to stale time and invalidation.

Paging strategy is declared on the list: `cursor` (Drive), `offset` (Mail,
Sheets, Writer) or `window` (Calendar). Cursor and offset share the same
`rows`, `hasNext`, `fetchNext` surface. A window list is keyed by its range.

Persist the entity store in IndexedDB for instant paint. A persisted entity
is stale on boot and always revalidates.

## Realtime

- `doc_update`: equal version means our own write echoing back, no-op. Newer
  means mark stale and refetch if observed.
- `list_update`: invalidate lists tagged with the doctype that do not contain
  the name. Coalesce per doctype.
- `doc_rename`: re-key. `update_user_permissions`: invalidate all.
- The engine joins a doc room while an entity is observed and a doctype room
  while a list is observed, and leaves on GC.
- App-specific events register in the product client module and invalidate or
  patch descriptors (`new_mail_created` carries mailbox ids, so it maps to the
  thread list of that mailbox). Drive's future node event uses the same path.

## Link codes

Each Drive operation declares which params name nodes. Transport picks
`X-Drive-Links` codes for those nodes and their known ancestors from the
link store, under the 20-item cap. Application code never touches the header.

## Fit for the other apps

| App | Fits | Stays outside |
|---|---|---|
| Calendar | events, calendars, settings | nothing |
| Slides | catalog, sharing, save with `modified` reconcile | 500 ms local autosave |
| Mail | all 179 RPC methods once outputs are typed | 30 s reconcile becomes `refetchInterval`; SSE delivery test |
| Meet | control plane, recordings by `state_revision` | SFU signalling, WebRTC, RTC stats |
| Sheets | lists, sharing, saves by `head_seq` | Yjs over Hocuspocus |
| Writer | catalog, versions, favourites | Yjs over WebRTC |

## Backend asks

- Drive: emit a node event with `{node, parent, root, modified, action}` from
  the workflow layer, per-folder rooms. Accept expected `modified` on PATCH
  and answer `DriveConflict`. Type `shapes.py` outputs.
- Mail: return `modified`, type outputs, fix `get_threads` returning a tuple.
- Writer: add return annotations.
- Calendar: stop faking `modified` on calendars.
- Unread notification count endpoint (already on the map).

## Testing

Suite's vitest aliases `frappe-ui` to a recorder stub. The engine needs its
own MSW setup. Tests create their own engine instance with a mock transport.

```ts
const server = mockServer({ [api.node_get]: () => fixture.folder })
const state = createServerState({ transport: server })
const folder = state.fetch(nodes.detail('f1'))
await expect(folder).resolves.toMatchObject({ title: 'Q3' })
expect(server.calls(api.node_get)).toHaveLength(1)
```

## Not decided yet

- Exact names for the platform primitives beyond `useQuery`, `useMutation`,
  `settled`, `run`, `silent`, `member`, `touches`, `optimistic`.
- GC timeout and default stale time.
- Whether output validation stays dev-only in production builds.
- Where generated files live and how the generator runs in the build.
- Prefetch on hover.

## Rejected

- Declarative contract classes in Python (`Query(...)`, `Mutation(...)`).
  Foreign idiom, second registry beside `ROUTES`.
- Effects declared in Python. Client cache knowledge belongs in the client.
- Mutable active records. A local copy hides which fields changed and fights
  optimistic rollback and realtime overwrites.
- Directly callable mutation descriptors. Two ways to write.
- A thenable query object. `await` and `Promise.resolve` auto-unwrap
  thenables in surprising places; `settled()` is explicit.
- Route-level data loaders. A third primitive copying an experimental Vue
  Router feature.
- `serverState.fetch(desc)` in guards. Replaced by `settled()`.
