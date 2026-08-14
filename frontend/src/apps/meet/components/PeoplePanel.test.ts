import { createApp, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("./PeopleParticipantTile.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			props: {
				participant: { type: Object, required: true },
				canPromoteToCohost: Boolean,
			},
			setup(props) {
				return () =>
					h("div", {
						"data-participant": String(props.participant.user_id),
						"data-can-promote": String(props.canPromoteToCohost),
					});
			},
		}),
	};
});

vi.mock("./PeopleWaitingSection.vue", () => ({
	default: defineComponent({ render: () => h("div") }),
}));

import PeoplePanel from "./PeoplePanel.vue";

const participant = {
	user_id: "member@example.com",
	user_name: "Member",
	avatar: null,
	initials: "M",
	is_guest: false,
};

function promotionPermission(
	currentUserId: string,
	coHosts: string[] = [],
	target = participant,
): string | null {
	const root = document.createElement("div");
	const app = createApp(PeoplePanel, {
		open: true,
		currentUser: { user_id: currentUserId, full_name: "Current User" },
		participants: { [target.user_id]: target },
		creatorUserId: "host@example.com",
		coHosts,
	});
	app.mount(root);

	const value = root
		.querySelector(`[data-participant="${target.user_id}"]`)
		?.getAttribute("data-can-promote") ?? null;
	app.unmount();
	return value;
}

describe("PeoplePanel co-host promotion", () => {
	it("offers promotion to the host for an authenticated participant", () => {
		expect(promotionPermission("host@example.com")).toBe("true");
	});

	it("does not offer promotion to a co-host", () => {
		expect(promotionPermission("cohost@example.com", ["cohost@example.com"])).toBe(
			"false",
		);
	});

	it("does not offer promotion for a guest", () => {
		expect(
			promotionPermission("host@example.com", [], {
				...participant,
				user_id: "guest_123",
				is_guest: true,
			}),
		).toBe("false");
	});
});
