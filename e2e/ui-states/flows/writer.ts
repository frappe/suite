import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Writer flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "writer",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const writer = defineFlow<Event, BaseScene>({
	id: "writer",
	title: "Writer",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
