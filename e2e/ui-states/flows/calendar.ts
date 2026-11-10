import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Calendar flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "calendar",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const calendar = defineFlow<Event, BaseScene>({
	id: "calendar",
	title: "Calendar",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
