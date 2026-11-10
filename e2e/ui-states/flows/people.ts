import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the People flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "people",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const people = defineFlow<Event, BaseScene>({
	id: "people",
	title: "People",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
