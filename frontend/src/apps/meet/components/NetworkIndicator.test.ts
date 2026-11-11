import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import type { MediaHealthState } from "../utils/media/MediaHealthMonitor";
import NetworkIndicator from "./NetworkIndicator.vue";

vi.mock("frappe-ui", () => ({
	Tooltip: defineComponent({
		setup(_, { slots }) {
			return () => h("span", slots.default?.());
		},
	}),
}));
afterEach(() => vi.useRealTimers());

function mount(health: MediaHealthState) {
	const root = document.createElement("div");
	const state = reactive(health);
	const app = createApp({
		render: () => h(NetworkIndicator, { health: state, isLocal: true }),
	});
	app.mount(root);
	return { root, state, app };
}

describe("NetworkIndicator", () => {
	it.each(["good", "checking", "reconnecting"] as const)(
		"shows nothing for %s without poor or critical evidence",
		(status) => {
			const { root, app } = mount({
				networkQuality: status === "good" ? "good" : "unknown",
				downlinkQuality: "unknown",
				isTransportFailed: false,
				status,
				issue: null,
			});
			expect(root.querySelector("[data-network-status]")).toBeNull();
			expect(root.textContent).toBe("");
			app.unmount();
		},
	);

	it("uses the existing warning icon and tooltip for poor and critical local reception, then hides after recovery", async () => {
		const { root, state, app } = mount({
			networkQuality: "good",
			downlinkQuality: "poor",
			isTransportFailed: false,
			status: "degraded",
			issue: "receive",
		});
		try {
			expect(
				root.querySelector('[data-network-status="poor"] svg'),
			).not.toBeNull();
			expect(
				root.querySelector('[role="img"]')?.getAttribute("aria-label"),
			).toContain("connection is weak");
			expect(root.textContent).toBe("");
			state.downlinkQuality = "critical";
			await nextTick();
			expect(
				root.querySelector('[data-network-status="critical"]'),
			).not.toBeNull();
			state.downlinkQuality = "good";
			state.status = "good";
			await nextTick();
			expect(root.querySelector("[data-network-status]")).toBeNull();
		} finally {
			app.unmount();
		}
	});

	it("classifies a failed transport or offline connection as critical", () => {
		const { root, app } = mount({
			networkQuality: "unknown",
			downlinkQuality: "unknown",
			isTransportFailed: false,
			status: "disconnected",
			issue: null,
		});
		expect(
			root.querySelector('[data-network-status="critical"]'),
		).not.toBeNull();
		app.unmount();
	});

	it("hides a stale remote warning without displaying an unavailable-status UI", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
		const root = document.createElement("div");
		const app = createApp(NetworkIndicator, {
			quality: "poor",
			updatedAt: Date.now(),
			participantName: "Alex",
		});
		app.mount(root);
		try {
			expect(root.querySelector('[data-network-status="poor"]')).not.toBeNull();
			await vi.advanceTimersByTimeAsync(18_000);
			await nextTick();
			expect(root.querySelector("[data-network-status]")).toBeNull();
			expect(root.textContent).toBe("");
		} finally {
			app.unmount();
		}
	});
});
