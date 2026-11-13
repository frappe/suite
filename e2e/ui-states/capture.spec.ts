import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "@playwright/test";
import { createTestModel } from "@xstate/graph";
import type { AnyFlow } from "./flow";
import { flows } from "./flows";
import { acrossRestarts, watchBench } from "./bench";
import { describeMachine, writeManifest, type EdgeRecord, type FlowManifest } from "./manifest";
import { OUT_DIR } from "./playwright.config";
import { openScene, type BaseScene } from "./scene";

const only = process.env.UI_STATES_FLOWS?.split(",").filter(Boolean);

// The canvas lays flows out in this order, whichever subset this run captures.
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "index.json"), JSON.stringify(flows.map((flow) => flow.id)));

for (const flow of flows) {
	if (only && !only.includes(flow.id)) continue;
	test(flow.id, async ({ browser, baseURL }) => {
		if (!baseURL) throw new Error("baseURL is required");
		const manifest: FlowManifest = {
			id: flow.id,
			title: flow.title,
			source: flow.source,
			...describeMachine(flow.machine),
			edges: [],
		};
		const paths = createTestModel(flow.machine).getShortestPaths();
		mkdirSync(resolve(OUT_DIR, flow.id), { recursive: true });
		const bench = watchBench(baseURL);
		let undo: (() => Promise<void>) | undefined;
		try {
			undo = await acrossRestarts(baseURL, async () => flow.prepare?.(browser));
			for (const path of paths) {
				await bench.survive(async () => {
					const scene = flow.open ? await flow.open(browser) : await openScene(browser, baseURL, flow.folderTitle ?? flow.title);
					try {
						await flow.enter(scene);
						let previous: string | null = null;
						for (const step of path.steps) {
							const state = String(step.state.value);
							if (previous !== null) {
								await flow.events[step.event.type](scene);
								recordEdge(manifest.edges, previous, step.event.type, state);
							}
							await capture(flow, scene, manifest, state, previous, step.event.type);
							previous = state;
						}
					} finally {
						await scene.close();
					}
				});
			}
		} finally {
			bench.stop();
			if (undo) await acrossRestarts(baseURL, undo);
		}
		writeManifest(OUT_DIR, manifest);
	});
}

function recordEdge(edges: EdgeRecord[], from: string, event: string, to: string): void {
	if (!edges.some((edge) => edge.from === from && edge.event === event && edge.to === to)) {
		edges.push({ from, event, to });
	}
}

/** Screenshots a state the first time a path reaches it. */
async function capture(
	flow: AnyFlow,
	scene: BaseScene,
	manifest: FlowManifest,
	state: string,
	parent: string | null,
	via: string,
): Promise<void> {
	const record = manifest.states.find((candidate) => candidate.id === state);
	if (!record) throw new Error(`${flow.id} reached unknown state ${state}`);
	if (record.screenshot) return;
	await flow.settle?.[state]?.(scene);
	await scene.settle();
	record.parent = parent;
	record.via = parent ? via : null;
	if (record.transient) return;
	const file = `${flow.id}/${state}.png`;
	const frame = flow.frame?.(scene, state) ?? null;
	const options = { path: resolve(OUT_DIR, file), animations: "disabled" as const, caret: "hide" as const };
	if (frame) await frame.screenshot(options);
	else await scene.page.screenshot(options);
	record.screenshot = file;
}
