import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Mail flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "mail",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const mail = defineFlow<Event, BaseScene>({
	id: "mail",
	title: "Mail",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
