import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceManager } from "../DeviceManager";

beforeEach(() => {
	deviceManager.cameras = [];
	deviceManager.microphones = [];
	deviceManager.speakers = [];
	deviceManager.deviceChangeListeners = [];
	deviceManager.isEnumerating = false;
	deviceManager.hasVideoPermission = false;
	deviceManager.hasAudioPermission = false;
});

afterEach(() => {
	deviceManager.cameras = [];
	deviceManager.microphones = [];
	deviceManager.speakers = [];
	deviceManager.deviceChangeListeners = [];
});

describe("findDeviceById", () => {
	it("finds a camera by deviceId", () => {
		deviceManager.cameras = [
			{ deviceId: "cam1", label: "Camera 1", groupId: "g1" },
			{ deviceId: "cam2", label: "Camera 2", groupId: "g2" },
		];
		const found = deviceManager.findDeviceById("cam2", "camera");
		expect(found?.label).toBe("Camera 2");
	});

	it("finds a microphone by deviceId", () => {
		deviceManager.microphones = [
			{ deviceId: "mic1", label: "Mic 1", groupId: "g1" },
		];
		const found = deviceManager.findDeviceById("mic1", "microphone");
		expect(found?.label).toBe("Mic 1");
	});

	it("finds a speaker by deviceId", () => {
		deviceManager.speakers = [
			{ deviceId: "spk1", label: "Speaker 1", groupId: "g1" },
		];
		const found = deviceManager.findDeviceById("spk1", "speaker");
		expect(found?.label).toBe("Speaker 1");
	});

	it("returns undefined for unknown deviceId", () => {
		deviceManager.cameras = [{ deviceId: "cam1", label: "C1", groupId: "g1" }];
		const found = deviceManager.findDeviceById("nope", "camera");
		expect(found).toBeUndefined();
	});

	it("returns undefined for empty list", () => {
		const found = deviceManager.findDeviceById("cam1", "camera");
		expect(found).toBeUndefined();
	});
});

describe("getDefaultDevice", () => {
	it("returns the first device", () => {
		deviceManager.cameras = [
			{ deviceId: "cam1", label: "Camera 1", groupId: "g1" },
			{ deviceId: "cam2", label: "Camera 2", groupId: "g2" },
		];
		const defaultCam = deviceManager.getDefaultDevice("camera");
		expect(defaultCam?.deviceId).toBe("cam1");
	});

	it("returns null when no devices", () => {
		expect(deviceManager.getDefaultDevice("camera")).toBeNull();
	});
});

describe("isDeviceAvailable", () => {
	it("returns true when device exists", () => {
		deviceManager.cameras = [{ deviceId: "cam1", label: "C1", groupId: "g1" }];
		expect(deviceManager.isDeviceAvailable("cam1", "camera")).toBe(true);
	});

	it("returns false when device does not exist", () => {
		expect(deviceManager.isDeviceAvailable("cam1", "camera")).toBe(false);
	});
});

describe("getCameras / getMicrophones / getSpeakers", () => {
	it("returns current lists", () => {
		deviceManager.cameras = [{ deviceId: "cam1", label: "C1", groupId: "g1" }];
		deviceManager.microphones = [
			{ deviceId: "mic1", label: "M1", groupId: "g1" },
		];
		deviceManager.speakers = [{ deviceId: "spk1", label: "S1", groupId: "g1" }];
		expect(deviceManager.getCameras()).toHaveLength(1);
		expect(deviceManager.getMicrophones()).toHaveLength(1);
		expect(deviceManager.getSpeakers()).toHaveLength(1);
	});
});

describe("addDeviceChangeListener / removeDeviceChangeListener", () => {
	it("adds and invokes listener", () => {
		const listener = vi.fn();
		deviceManager.addDeviceChangeListener(listener);
		expect(deviceManager.deviceChangeListeners).toHaveLength(1);
	});

	it("removes listener", () => {
		const listener = vi.fn();
		deviceManager.addDeviceChangeListener(listener);
		deviceManager.removeDeviceChangeListener(listener);
		expect(deviceManager.deviceChangeListeners).toHaveLength(0);
	});

	it("removeDeviceChangeListener does nothing for unknown listener", () => {
		deviceManager.removeDeviceChangeListener(vi.fn());
		expect(deviceManager.deviceChangeListeners).toHaveLength(0);
	});
});
