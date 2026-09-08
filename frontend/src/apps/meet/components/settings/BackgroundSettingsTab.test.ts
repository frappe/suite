import { createApp, h, markRaw, nextTick, ref, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", async () => {
	const { defineComponent, h } = await import("vue");
	const container = defineComponent({
		setup: (_, { slots }) => () => h("div", slots.default?.()),
	});
	return {
		Button: defineComponent({
			setup: (_, { attrs, slots }) => () => h("button", attrs, slots.default?.()),
		}),
		Tooltip: container,
		SettingsHeader: container,
		SettingsBody: container,
		toast: { success: vi.fn(), error: vi.fn() },
	};
});
vi.mock("../../utils/customImages", () => ({
	loadCustomImages: vi.fn().mockResolvedValue([]),
	deleteCustomImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../composables/useMeetingContext", () => ({
	useMeetingContext: () => null,
}));
const effects = vi.hoisted(() => ({
	applyBackgroundEffects: vi.fn(),
	stopProcessing: vi.fn(),
}));
vi.mock("../../composables/useBackgroundEffects", () => ({
	useBackgroundEffects: () => effects,
}));

import BackgroundSettingsTab from "./BackgroundSettingsTab.vue";
import * as preferences from "../../data/backgroundEffects";
import { selectedCameraId } from "../../data/mediaPreferences";
import { deleteCustomImage } from "../../utils/customImages";

let app: App;
let root: HTMLElement;
const visible = ref(true);
const rawStop = vi.fn();
const processedStop = vi.fn();
const rawStream = markRaw({ getTracks: () => [{ stop: rawStop }] });
const processedStream = markRaw({ getTracks: () => [{ stop: processedStop }] });
const updateOptions = vi.fn().mockResolvedValue(undefined);
const cleanup = vi.fn();

async function settle() {
	await nextTick();
	await Promise.resolve();
	await nextTick();
}

function tile(label: string): HTMLElement {
	const text = [...root.querySelectorAll("p")].find((p) => p.textContent?.trim() === label);
	if (!text) throw new Error(`Missing background tile: ${label}`);
	return text.parentElement!.parentElement!;
}

beforeEach(async () => {
	vi.clearAllMocks();
	localStorage.clear();
	preferences.setBackgroundBlurEnabled(false);
	preferences.setBackgroundImageEnabled(false);
	preferences.setSelectedBackgroundImage("");
	preferences.setAutoFramingEnabled(false);
	preferences.customBackgroundImages.value = [
		{ name: "custom_office", label: "My office", url: "data:image/png;base64,AA==", isCustom: true },
	];
	selectedCameraId.value = "camera";
	visible.value = true;
	vi.stubGlobal("navigator", {
		mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(rawStream) },
	});
	effects.applyBackgroundEffects.mockResolvedValue({ stream: processedStream, updateOptions, cleanup });
	root = document.createElement("div");
	app = createApp({ render: () => h(BackgroundSettingsTab, { isVisible: visible.value }) });
	for (const name of ["loader", "circle-user-round", "plus", "check", "x", "alert-triangle"]) {
		app.component(`lucide-${name}`, { render: () => h("span") });
	}
	app.mount(root);
	await settle();
});

afterEach(() => {
	app.unmount();
	vi.unstubAllGlobals();
});

describe("BackgroundSettingsTab", () => {
	it("persists image IDs and keeps blur, image, and none mutually exclusive", async () => {
		tile("Beach").click();
		await settle();
		expect(tile("Beach").classList.contains("ring-1")).toBe(true);
		expect(localStorage.getItem("backgroundEffects.imageName")).toBe("beach");
		expect(localStorage.getItem("backgroundEffects.image")).toBe("1");
		expect(effects.applyBackgroundEffects).toHaveBeenLastCalledWith(rawStream,
			expect.objectContaining({ selectedBackgroundImage: "beach", backgroundImageEnabled: true }),
			expect.any(AbortSignal));

		for (const [label, intensity] of [["Slight Blur", 9], ["Blur", 20]] as const) {
			tile(label).click();
			await settle();
			expect(tile(label).classList.contains("ring-1")).toBe(true);
			expect(updateOptions).toHaveBeenLastCalledWith(expect.objectContaining({
				backgroundBlurEnabled: true, backgroundImageEnabled: false, blurIntensity: intensity,
			}));
			expect(localStorage.getItem("backgroundEffects.image")).toBe("0");
		}
		tile("My office").click();
		await settle();
		expect(localStorage.getItem("backgroundEffects.imageName")).toBe("custom_office");
		expect(localStorage.getItem("backgroundEffects.blur")).toBe("0");
		expect(updateOptions).toHaveBeenLastCalledWith(expect.objectContaining({
			selectedBackgroundImage: "custom_office", backgroundImageEnabled: true, backgroundBlurEnabled: false,
		}));
		tile("None").click();
		await settle();
		expect(tile("None").classList.contains("ring-1")).toBe(true);
		expect(localStorage.getItem("backgroundEffects.image")).toBe("0");
		expect(localStorage.getItem("backgroundEffects.blur")).toBe("0");
	});

	it("syncs external built-in/custom preferences, rejects unknown IDs, and clears deleted selections", async () => {
		preferences.setBackgroundImageEnabled(true);
		for (const [id, label] of [["mountains", "Mountains"], ["custom_office", "My office"]]) {
			preferences.setSelectedBackgroundImage(id);
			await settle();
			expect(tile(label).classList.contains("ring-1")).toBe(true);
		}
		preferences.setSelectedBackgroundImage("missing");
		await settle();
		expect(tile("None").classList.contains("ring-1")).toBe(true);
		expect(preferences.selectedBackgroundImage.value).toBe("");
		expect(preferences.backgroundImageEnabled.value).toBe(false);
		tile("My office").click();
		await settle();
		tile("My office").querySelector<HTMLElement>(".group-hover\\:opacity-100")!.click();
		await settle();
		expect(deleteCustomImage).toHaveBeenCalledWith("custom_office");
		expect(root.textContent).not.toContain("My office");
		expect(localStorage.getItem("backgroundEffects.imageName")).toBe("");
		expect(tile("None").classList.contains("ring-1")).toBe(true);
	});

	it("updates the existing preview and releases it when hidden", async () => {
		tile("Beach").click();
		await settle();
		expect(root.querySelector("video")!.srcObject).toBe(processedStream);
		tile("Mountains").click();
		await settle();
		expect(effects.applyBackgroundEffects).toHaveBeenCalledTimes(1);
		expect(updateOptions).toHaveBeenLastCalledWith(expect.objectContaining({ selectedBackgroundImage: "mountains" }));
		visible.value = false;
		await settle();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(rawStop).toHaveBeenCalled();
		expect(processedStop).toHaveBeenCalledOnce();
		expect(root.querySelector("video")!.srcObject).toBeNull();
	});
});
