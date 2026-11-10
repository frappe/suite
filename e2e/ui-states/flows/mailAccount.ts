import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Mail account flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "mailAccount",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const mailAccount = defineFlow<Event, BaseScene>({
	id: "mailAccount",
	title: "Mail account",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
