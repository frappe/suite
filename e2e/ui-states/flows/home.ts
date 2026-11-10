import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Home flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "home",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const home = defineFlow<Event, BaseScene>({
	id: "home",
	title: "Home",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
