# Drive UI states

Walks every Drive screen and interaction state as an explicit state machine and screenshots each state once. The output feeds a review canvas; it is not a test suite.

## Run

The bench that serves the site must be running, with `allow_tests`, `storage_v2` and `ignore_csrf` set on the site. One capture at a time, and one flow at a time within it: flows share the provisioned users, so their Trash and Recent.

```sh
cd e2e/ui-states
E2E_BENCH_PATH=/path/to/bench UI_STATES_FLOWS=listing,share \
  flock /tmp/ui-states-capture.lock npx playwright test -c playwright.config.ts
```

`BASE_URL` defaults to `http://dev-suite-drive-ui-states.localhost:8021`. Leave `UI_STATES_FLOWS` out to run every flow. The dev bench restarts itself after 5000 requests and its port refuses connections meanwhile; `bench.ts` walks a path again when that happens, and any other failure fails the run. Screenshots and one `<flow>.json` per flow land in `out/`. The review canvas is built from `out/` by the `review-ui-states` skill, which owns the page.

## Files

- `flow.ts`: a flow is an XState machine plus `enter` and one step per event. State `meta.description` is what the canvas shows; `meta.transient` keeps a state in the graph without a screenshot.
- `bench.ts`: watches the bench's port so a path that failed during a bench restart is walked again.
- `scene.ts`: one signed-in browser per path, with its own folder under `UI states` in My files (purged on close), `hold()` for mid-flight and failed requests, `as()` for a second user.
- `content.ts`: fills a folder with the mix a real folder has.
- `capture.spec.ts`: walks the shortest path to every state, screenshots each state the first time a path reaches it, records parent, event and edges.
- `flows/`: one file per flow; `flows/index.ts` lists them in canvas order.

## Writing a flow

1. Read the code the flow covers and name every state the user can see, including loading, empty, failed and mid-flight ones. Name states for what the user sees, not for the code's variables.
2. Put the machine in `setupFlow<Event>().createMachine(...)`. Every state needs `meta.description`. Keep machines flat; a second presentation (grid, phone) is its own flow or its own states.
3. `enter` seeds through the API (`content.ts`, `drive-backed-apps/helpers/drive.ts`) and navigates. Each event step performs the interaction and waits for the target state with an `expect`, so a screenshot is never taken early.
4. Reach unreachable states with `scene.hold()`: hold a request for a skeleton or mid-flight state, `abort()` it for a failure, `release()` to continue. The transport retries 5xx, so `abort()` keeps failing until `release()`.
5. Run the flow, look at every screenshot in `out/<flow>/`, and fix steps whose screenshot is not the state they claim.
