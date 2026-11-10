import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Draw flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "draw",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const draw = defineFlow<Event, BaseScene>({
	id: "draw",
	title: "Draw",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
