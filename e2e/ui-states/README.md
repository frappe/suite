# Drive UI states

Walks every Drive screen and interaction state as an explicit state machine and screenshots each state once. The output feeds a review canvas; it is not a test suite.

## Run

Install once, from `e2e/`: `yarn install`, then `npx playwright install chromium`.

The bench that serves the site must be running, with `allow_tests`, `storage_v2` and `ignore_csrf` set on the site. One capture at a time, and one flow at a time within it: flows share the provisioned users, so their Trash and Recent.

```sh
cd e2e/ui-states
E2E_BENCH_PATH=/path/to/bench UI_STATES_FLOWS=listing,share \
  flock /tmp/ui-states-capture.lock npx playwright test -c playwright.config.ts
```

- `E2E_BENCH_PATH` is required: the bench that serves the site.
- `BASE_URL` defaults to `http://dev-suite-drive-ui-states.localhost:8021`.
- `E2E_TEST_API_URL` is the server for `suite.drive.e2e_api`, which needs `DEV_SERVER=1`. It defaults to `BASE_URL`'s host on port 8095. The run starts a `frappe serve` there from `E2E_BENCH_PATH`, or reuses one already listening.
- `UI_STATES_FLOWS` picks flows by id. Leave it out to run every flow.

The dev bench restarts itself after 5000 requests and its port refuses connections meanwhile; `bench.ts` walks a path again when that happens, and any other failure fails the run.

Each run writes to `out/`: screenshots in `out/<flow>/`, one `<flow>.json` per flow captured, and `index.json` with every flow id in canvas order. The review canvas is built from `out/` by the `review-ui-states` skill, which owns the page.

## Files

- `flow.ts`: a flow is an XState machine plus `enter` and one step per event. State `meta.description` is what the canvas shows; `meta.transient` keeps a state in the graph without a screenshot.
- `bench.ts`: watches the bench's port so a path that failed during a bench restart is walked again.
- `scene.ts`: one signed-in browser per path, with its own folder under `UI states` in My files (purged on close). `hold()` and `lastHold` for mid-flight and failed requests, `as()` and `pageAs()` for a second user, `perScene()` for a value a flow keeps per path.
- `content.ts`: fills a folder with the mix a real folder has, and reads `fixtures/`.
- `capture.spec.ts`: walks the shortest path to every state, screenshots each state the first time a path reaches it, records parent, event and edges.
- `flows/`: one file per flow; `flows/index.ts` lists them in canvas order.

## Writing a flow

1. Read the code the flow covers and name every state the user can see, including loading, empty, failed and mid-flight ones. Name states for what the user sees, not for the code's variables.
2. Put the machine in `setupFlow<Event>().createMachine(...)`. Every state needs `meta.description`. Keep machines flat; a second presentation (grid, phone) is its own flow or its own states.
3. Export it with `defineFlow<Event>({...})` and add it to `flows/index.ts`, where the array order is the canvas order. The skeleton below shows the fields.
4. `enter` seeds through the API (`content.ts`, `drive-backed-apps/helpers/drive.ts`) and navigates. Each event step performs the interaction and waits for the target state with an `expect`, so a screenshot is never taken early. A step must not ask the page which state it is in: two starting states that need different steps get two events.
5. Reach states a normal load passes too quickly with `scene.hold()`: hold a request for a skeleton or mid-flight state, `abort()` it for a failure, `release()` to continue. The transport retries 5xx, so `abort()` keeps failing until `release()`.
6. A state too brief to screenshot, or one this site cannot reach, still goes in the machine with `meta.transient: true`. Say why in its description. An unreachable state has no transition leading to it.
7. Run the flow, look at every screenshot in `out/<flow>/`, and fix steps whose screenshot is not the state they claim.

```ts
import { expect } from "@playwright/test";
import { folderPath } from "../content";
import { defineFlow, setupFlow } from "../flow";

type Event = { type: "OPEN_NEW" };

const machine = setupFlow<Event>().createMachine({
	id: "example",
	initial: "folder",
	states: {
		folder: {
			meta: { description: "An empty folder." },
			on: { OPEN_NEW: "newMenu" },
		},
		newMenu: {
			meta: { description: "The New menu, open." },
		},
	},
});

export const example = defineFlow<Event>({
	id: "example", // Names out/<id>/ and <id>.json, and what UI_STATES_FLOWS matches.
	title: "Example", // The flow's heading on the canvas.
	folderTitle: "Press kit", // Optional: the path folder's title in screenshots. Defaults to the title.
	source: "frontend/src/apps/drive/files/pages/FilesPage.vue", // Where the machine lives in the code.
	machine,
	async enter(scene) {
		await scene.goto(folderPath(scene.folder));
	},
	events: {
		async OPEN_NEW(scene) {
			await scene.page.getByRole("button", { name: "New", exact: true }).click();
			await expect(scene.page.getByRole("menu")).toBeVisible();
		},
	},
	// Optional: settle waits per state before its screenshot; frame screenshots another page for a state.
});
```
