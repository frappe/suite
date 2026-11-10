import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Suite settings flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "suiteSettings",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const suiteSettings = defineFlow<Event, BaseScene>({
	id: "suiteSettings",
	title: "Suite settings",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
