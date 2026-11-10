import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Welcome flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "welcome",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const welcome = defineFlow<Event, BaseScene>({
	id: "welcome",
	title: "Welcome",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
