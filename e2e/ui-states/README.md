# Suite UI states

Walks every Suite screen and interaction state as an explicit state machine and screenshots each state once. The output feeds a review canvas; it is not a test suite.

Flows run against three sites on one bench:

- **The Drive site** (`BASE_URL`): e2e users provisioned per run. Drive, the editors' file flows, sharing and the guest views use it.
- **The demo site** (`UI_STATES_DEMO_URL`, default `http://ui-states-suite.localhost:8021`): the Northwind dataset from `suite.composition.demo.drive.seed`, with its own Stalwart, so Mail, Calendar, People, Home, Admin and the editors have real-looking content. The seed prints the shared password once; save it as `{"password": "…"}` in the file `UI_STATES_DEMO` names (default `~/.local/state/ui-states/demo.json`). Never commit it. `admin` maps the site without Suite Cloud, and `mailAdmin` needs the stand-in (`"suite_cloud_fake": 1` in its config), so they cannot pass in one run: capture `mailAdmin` on its own with the stand-in on, then turn it off. The site reads its config again within a minute.
- **The setup site** (`UI_STATES_SETUP_URL`, default `http://ui-states-setup.localhost:8021`): a site never set up, for the first Admin's wizard.

## Run

Install once, from `e2e/`: `yarn install`, then `npx playwright install chromium`.

The bench that serves the site must be running, with `allow_tests`, `storage_v2` and `ignore_csrf` set on the site. One capture at a time, and one flow at a time within it: flows share the provisioned users, so their Trash, Recent and Shared with me would mix.

```sh
cd e2e/ui-states
E2E_BENCH_PATH=/path/to/bench UI_STATES_FLOWS=listing,share \
  flock /tmp/ui-states-capture.lock npx playwright test -c playwright.config.ts
```

- `E2E_BENCH_PATH` is required: the bench that serves the site.
- `BASE_URL` defaults to `http://dev-suite-drive-ui-states.localhost:8021`.
- `E2E_TEST_API_URL` is the server for `suite.drive.e2e_api`, which needs `DEV_SERVER=1`. It defaults to `BASE_URL`'s host on port 8095. The run starts a `frappe serve` there from `E2E_BENCH_PATH`, or reuses one already listening.
- `UI_STATES_FLOWS` picks flows by id. Leave it out to run every flow.

The dev bench restarts itself after 5000 requests and its port refuses connections meanwhile. When that happens, the path's cleanups run again once the bench is back, and `bench.ts` walks the path again; any other failure fails the run.

Each run writes to `out/`: screenshots in `out/<flow>/`, one `<flow>.json` per flow captured, and `index.json` with every flow id in canvas order. The review canvas is built from `out/` by the `review-ui-states` skill, which owns the page.

## Files

- `flow.ts`: a flow is an XState machine plus `enter` and one step per event. State `meta.description` is what the canvas shows; `meta.transient` keeps a state in the graph without a screenshot.
- `bench.ts`: watches the bench's port so a path that failed during a bench restart is walked again, and a cleanup that failed for it runs again.
- `scene.ts`: one signed-in browser per path, with its own folder under `UI states` in My files (purged on close). `hold()` and `lastHold` for mid-flight and failed requests, `dialog()`, `toast()` and `rowAction()` for the page's own widgets, `as()` and `pageAs()` for a second user, `defer()` for a cleanup, `perScene()` for a value a flow keeps per path, and `callMethod()` for a whitelisted method.
- `demo.ts`: the demo and setup sites, `openDemoScene()` / `openSetupScene()` for a flow's `open`, the demo people's names, and `personalAccount()` for a person's mail account.
- `global-setup.ts`: provisions the Drive site's users into `.state/`, gives them real-looking names, and removes them at teardown.
- `manifest.ts`: the per-flow JSON the canvas reads.
- `content.ts`: fills a folder with the mix a real folder has, and reads `fixtures/`.
- `capture.spec.ts`: walks the shortest path to every state, screenshots each state the first time a path reaches it, records parent, event and edges.
- `flows/`: one file per flow; `flows/index.ts` lists them in canvas order.

## Writing a flow

1. Read the code the flow covers and name every state the user can see, including loading, empty, failed and mid-flight ones. Name states for what the user sees, not for the code's variables.
2. Put the machine in `setupFlow<Event>().createMachine(...)`. Every state needs `meta.description`. Keep machines flat; a second presentation (grid, phone) is its own flow or its own states.
3. Export it with `defineFlow<Event>({...})` and add it to `flows/index.ts`, where the array order is the canvas order. The skeleton below shows the fields.
4. A flow on the demo or setup site sets `open(browser)` to `openDemoScene(browser)` or `openSetupScene(browser)`; without `open` it gets a Drive scene. `enter` seeds through the API (`content.ts`, `drive-backed-apps/helpers/drive.ts`) and navigates. Each event step performs the interaction and waits for the target state with an `expect`, so a screenshot is never taken early. A step must not ask the page which state it is in: two starting states that need different steps get two events.
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
