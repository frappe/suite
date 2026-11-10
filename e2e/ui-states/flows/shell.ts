import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Shell flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "shell",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const shell = defineFlow<Event, BaseScene>({
	id: "shell",
	title: "Shell",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
