import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Mail admin flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "mailAdmin",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const mailAdmin = defineFlow<Event, BaseScene>({
	id: "mailAdmin",
	title: "Mail admin",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
