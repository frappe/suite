import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

// Placeholder: replace with the Compose and outbox flow.
type Event = { type: "NONE" };

const machine = setupFlow<Event>().createMachine({
	id: "compose",
	initial: "todo",
	states: { todo: { meta: { description: "Not mapped yet.", transient: true } } },
});

export const compose = defineFlow<Event, BaseScene>({
	id: "compose",
	title: "Compose and outbox",
	source: "",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter() {},
	events: { async NONE() {} },
});
