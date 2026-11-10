import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Admin flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "admin",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const admin = defineFlow<Event, BaseScene>({
	id: "admin",
	title: "Admin",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
