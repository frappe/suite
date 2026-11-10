import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Meet flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "meet",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const meet = defineFlow<Event, BaseScene>({
	id: "meet",
	title: "Meet",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
