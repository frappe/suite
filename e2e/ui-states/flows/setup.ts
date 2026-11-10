import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Site setup flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "setup",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const setup = defineFlow<Event, BaseScene>({
	id: "setup",
	title: "Site setup",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
