import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Sheets flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "sheets",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const sheets = defineFlow<Event, BaseScene>({
	id: "sheets",
	title: "Sheets",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
