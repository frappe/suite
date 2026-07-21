/**
 * Device Management Utilities
 */

interface MediaDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export type DeviceType = "camera" | "microphone" | "speaker";

class DeviceManager {
	cameras: MediaDevice[];
	microphones: MediaDevice[];
	speakers: MediaDevice[];
	isEnumerating: boolean;
	deviceChangeListeners: Array<() => void>;

	constructor() {
		this.cameras = [];
		this.microphones = [];
		this.speakers = [];
		this.isEnumerating = false;
		this.deviceChangeListeners = [];
		this.setupDeviceChangeListener();
	}

	/**
	 * Detect what type of devices changed by comparing current vs new device lists
	 * Returns { video: boolean, audio: boolean } indicating what changed
	 */
	async detectDeviceChanges(): Promise<{
		videoChanged: boolean;
		audioChanged: boolean;
	}> {
		const oldCameraCount = this.cameras.length;
		const oldMicCount = this.microphones.length;
		const oldSpeakerCount = this.speakers.length;

		const devices = await navigator.mediaDevices.enumerateDevices();
		const newCameraCount = devices.filter(
			(d) => d.kind === "videoinput",
		).length;
		const newMicCount = devices.filter((d) => d.kind === "audioinput").length;
		const newSpeakerCount = devices.filter(
			(d) => d.kind === "audiooutput",
		).length;

		return {
			videoChanged: newCameraCount !== oldCameraCount,
			audioChanged:
				newMicCount !== oldMicCount || newSpeakerCount !== oldSpeakerCount,
		};
	}

	async enumerateDevices(): Promise<void> {
		if (this.isEnumerating) return;

		try {
			this.isEnumerating = true;

			const devices = await navigator.mediaDevices.enumerateDevices();

			this.cameras = devices
				.filter((device) => device.kind === "videoinput")
				.map((device, index) => ({
					deviceId: device.deviceId,
					label: device.label || `Camera ${index + 1}`,
					groupId: device.groupId,
				}));

			this.microphones = devices
				.filter((device) => device.kind === "audioinput")
				.map((device, index) => ({
					deviceId: device.deviceId,
					label: device.label || `Microphone ${index + 1}`,
					groupId: device.groupId,
				}));

			this.speakers = devices
				.filter((device) => device.kind === "audiooutput")
				.map((device) => ({
					deviceId: device.deviceId,
					label: device.label || `Speaker ${this.speakers.length + 1}`,
					groupId: device.groupId,
				}));
		} catch (error) {
			console.error("Failed to enumerate devices:", error);
			throw error;
		} finally {
			this.isEnumerating = false;
		}
	}

	getCameras(): MediaDevice[] {
		return this.cameras;
	}

	getMicrophones(): MediaDevice[] {
		return this.microphones;
	}

	getSpeakers(): MediaDevice[] {
		return this.speakers;
	}

	findDeviceById(
		deviceId: string,
		deviceType: DeviceType,
	): MediaDevice | undefined {
		const devices =
			deviceType === "camera"
				? this.cameras
				: deviceType === "microphone"
					? this.microphones
					: this.speakers;
		return devices.find((device) => device.deviceId === deviceId);
	}

	getDefaultDevice(deviceType: DeviceType): MediaDevice | null {
		const devices =
			deviceType === "camera"
				? this.cameras
				: deviceType === "microphone"
					? this.microphones
					: this.speakers;
		return devices.length > 0 ? devices[0] : null;
	}

	isDeviceAvailable(deviceId: string, deviceType: DeviceType): boolean {
		return this.findDeviceById(deviceId, deviceType) !== undefined;
	}

	setupDeviceChangeListener(): void {
		if (navigator.mediaDevices?.addEventListener) {
			navigator.mediaDevices.addEventListener("devicechange", async () => {
				console.log("Device change detected, re-enumerating devices...");

				try {
					const changes = await this.detectDeviceChanges();

					console.log("Device change type:", {
						videoChanged: changes.videoChanged,
						audioChanged: changes.audioChanged,
					});

					await this.enumerateDevices();

					for (const listener of this.deviceChangeListeners) {
						try {
							listener();
						} catch (error) {
							console.error("Error in device change listener:", error);
						}
					}
				} catch (error) {
					console.error("Failed to re-enumerate devices on change:", error);
				}
			});
		}
	}

	addDeviceChangeListener(listener: () => void): void {
		this.deviceChangeListeners.push(listener);
	}

	removeDeviceChangeListener(listener: () => void): void {
		const index = this.deviceChangeListeners.indexOf(listener);
		if (index > -1) {
			this.deviceChangeListeners.splice(index, 1);
		}
	}
}

export const deviceManager = new DeviceManager();
