import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Slides flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "slides",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const slides = defineFlow<Event, BaseScene>({
	id: "slides",
	title: "Slides",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
