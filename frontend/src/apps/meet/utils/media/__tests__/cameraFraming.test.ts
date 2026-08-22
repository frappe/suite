import { describe, expect, it, vi } from "vitest";

const bundledFaceDetector = vi.hoisted(() => {
	const close = vi.fn().mockResolvedValue(undefined);
	class FaceDetection {
		close = close;
		initialize = vi.fn().mockResolvedValue(undefined);
		onResults = vi.fn();
		send = vi.fn().mockResolvedValue(undefined);
		setOptions = vi.fn();
	}
	const moduleDefault: { FaceDetection: typeof FaceDetection | undefined } = {
		FaceDetection,
	};
	return { close, FaceDetection, moduleDefault };
});

vi.mock("@mediapipe/face_detection", () => ({
	default: bundledFaceDetector.moduleDefault,
}));

import {
	CameraFramingProcessor,
	CameraFramingTracker,
} from "../../cameraFraming";

describe("CameraFramingTracker", () => {
	it("tracks the largest face and keeps the crop inside the source", () => {
		const tracker = new CameraFramingTracker();
		tracker.updateFaces(
			[
				{ xCenter: 0.8, yCenter: 0.2, width: 0.08, height: 0.1 },
				{ xCenter: 0.95, yCenter: 0.4, width: 0.2, height: 0.24 },
			],
			0,
		);

		let crop = tracker.getCrop(1280, 720, 16);
		for (let now = 32; now <= 1500; now += 16) {
			crop = tracker.getCrop(1280, 720, now);
		}

		expect(crop.width).toBeLessThan(1280);
		expect(crop.x).toBeGreaterThanOrEqual(0);
		expect(crop.x + crop.width).toBeLessThanOrEqual(1280);
		expect(crop.y).toBeGreaterThanOrEqual(0);
		expect(crop.y + crop.height).toBeLessThanOrEqual(720);
	});

	it("holds a missing face briefly and then eases back to the full frame", () => {
		const tracker = new CameraFramingTracker();
		tracker.updateFaces(
			[{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height: 0.24 }],
			0,
		);
		for (let now = 16; now <= 1000; now += 16) {
			tracker.getCrop(1280, 720, now);
		}
		const zoomed = tracker.getCrop(1280, 720, 1000);
		const held = tracker.getCrop(1280, 720, 1400);
		const resetting = tracker.getCrop(1280, 720, 1800);
		let reset = resetting;
		for (let now = 1816; now <= 4000; now += 16) {
			reset = tracker.getCrop(1280, 720, now);
		}

		expect(held.width).toBeLessThanOrEqual(zoomed.width);
		expect(resetting.width).toBeGreaterThan(held.width);
		expect(reset.width).toBeCloseTo(1280, 0);
		expect(reset.height).toBeCloseTo(720, 0);
	});

	it("eases back to the full frame when disabled", () => {
		const tracker = new CameraFramingTracker();
		const face = [{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height: 0.24 }];
		for (let now = 0; now <= 1000; now += 20) {
			if (now % 200 === 0) tracker.updateFaces(face, now);
			tracker.getCrop(1280, 720, now);
		}
		const fitted = tracker.getCrop(1280, 720, 1000);

		tracker.setPaused(true);
		tracker.setEnabled(false);
		tracker.setPaused(false);
		const easing = tracker.getCrop(1280, 720, 1020);
		expect(tracker.isAtFullFrame()).toBe(false);
		let fullFrame = easing;
		for (let now = 1040; now <= 4000; now += 20) {
			fullFrame = tracker.getCrop(1280, 720, now);
		}

		expect(easing.width).toBeGreaterThan(fitted.width);
		expect(easing.width).toBeLessThan(1280);
		expect(fullFrame.width).toBeCloseTo(1280, 0);
		expect(tracker.isAtFullFrame()).toBe(true);
	});

	it("ignores small face-box fluctuations while the subject is stationary", () => {
		const tracker = new CameraFramingTracker();
		const widths: number[] = [];

		for (let detectedAt = 0; detectedAt <= 5000; detectedAt += 200) {
			const height =
				detectedAt < 3000 ? 0.235 : detectedAt % 400 === 0 ? 0.225 : 0.255;
			tracker.updateFaces(
				[{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height }],
				detectedAt,
			);
			for (let now = detectedAt; now < detectedAt + 200; now += 20) {
				const crop = tracker.getCrop(1280, 720, now);
				if (now >= 4000) widths.push(crop.width);
			}
		}

		expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(3);
	});

	it("accepts a sustained zoom change", () => {
		const tracker = new CameraFramingTracker();
		const face = (height: number) => [
			{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height },
		];
		tracker.updateFaces(face(0.24), 0);
		for (let now = 0; now <= 600; now += 20) {
			tracker.getCrop(1280, 720, now);
		}
		const initialWidth = tracker.getCrop(1280, 720, 600).width;

		for (const detectedAt of [600, 800, 1000, 1200, 1400]) {
			tracker.updateFaces(face(0.18), detectedAt);
			for (let now = detectedAt; now < detectedAt + 200; now += 20) {
				tracker.getCrop(1280, 720, now);
			}
		}

		expect(tracker.getCrop(1280, 720, 1600).width).toBeLessThan(
			initialWidth - 100,
		);
	});

	it("zooms to the minimum crop for a distant detected face", () => {
		const tracker = new CameraFramingTracker();
		tracker.updateFaces(
			[{ xCenter: 0.5, yCenter: 0.35, width: 0.04, height: 0.05 }],
			0,
		);
		let crop = tracker.getCrop(1280, 720, 0);
		for (let now = 20; now <= 1500; now += 20) {
			tracker.updateFaces(
				[{ xCenter: 0.5, yCenter: 0.35, width: 0.04, height: 0.05 }],
				now,
			);
			crop = tracker.getCrop(1280, 720, now);
		}

		expect(crop.width).toBeLessThan(520);
	});

	it("holds the current crop while paused and resumes tracking", () => {
		const tracker = new CameraFramingTracker();
		const face = (xCenter: number) => [
			{ xCenter, yCenter: 0.3, width: 0.2, height: 0.24 },
		];
		tracker.updateFaces(face(0.35), 0);
		for (let now = 0; now <= 1000; now += 20) {
			tracker.getCrop(1280, 720, now);
		}
		const fixed = tracker.getCrop(1280, 720, 1000);

		tracker.setPaused(true);
		tracker.updateFaces(face(0.75), 1200);
		const paused = tracker.getCrop(1280, 720, 4000);

		expect(paused).toEqual(fixed);

		tracker.setPaused(false);
		expect(tracker.getCrop(1280, 720, 4020)).toEqual(fixed);
		tracker.updateFaces(face(0.75), 4200);
		for (let now = 4200; now <= 5500; now += 20) {
			tracker.getCrop(1280, 720, now);
		}

		expect(tracker.getCrop(1280, 720, 5500).x).toBeGreaterThan(fixed.x);
	});

	it("restores a persisted crop snapshot and resumes tracking from it", () => {
		const tracker = new CameraFramingTracker();
		const face = (xCenter: number) => [
			{ xCenter, yCenter: 0.3, width: 0.2, height: 0.24 },
		];
		tracker.updateFaces(face(0.35), 0);
		for (let now = 0; now <= 1000; now += 20) {
			tracker.getCrop(1280, 720, now);
		}
		const snapshot = tracker.getNormalizedCrop();
		tracker.setPaused(true);
		const locked = tracker.getCrop(1280, 720, 1000);

		const restored = new CameraFramingTracker();
		restored.restoreCrop(snapshot);
		restored.setPaused(true);
		expect(restored.getCrop(1280, 720, 5000)).toEqual(locked);

		restored.setPaused(false);
		expect(restored.getCrop(1280, 720, 5020)).toEqual(locked);
		restored.updateFaces(face(0.75), 5200);
		for (let now = 5200; now <= 6500; now += 20) {
			restored.getCrop(1280, 720, now);
		}

		expect(restored.getCrop(1280, 720, 6500).x).toBeGreaterThan(locked.x);
	});

	it("does not report a crop before the first detection or restore", () => {
		const tracker = new CameraFramingTracker();

		expect(tracker.getNormalizedCrop()).toBeNull();
		tracker.getCrop(1280, 720, 0);
		tracker.getCrop(1280, 720, 500);
		expect(tracker.getNormalizedCrop()).toBeNull();

		tracker.setPaused(true);
		tracker.setPaused(false);
		tracker.updateFaces([], 600);
		tracker.getCrop(1280, 720, 620);
		tracker.getCrop(1280, 720, 640);
		expect(tracker.getNormalizedCrop()).toBeNull();

		tracker.updateFaces(
			[{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height: 0.24 }],
			0,
		);
		expect(tracker.getNormalizedCrop()).toBeNull();

		tracker.restoreCrop({ x: 0.1, y: 0.1, size: 0.5 });
		expect(tracker.getNormalizedCrop()).toEqual({
			x: 0.1,
			y: 0.1,
			size: 0.5,
		});
	});

	it("clamps an out-of-bounds restored crop into the frame", () => {
		const tracker = new CameraFramingTracker();
		tracker.restoreCrop({ x: -0.5, y: 2, size: 1.5 });

		const crop = tracker.getCrop(1280, 720, 0);

		expect(crop.x).toBe(0);
		expect(crop.y).toBe(0);
		expect(crop.width).toBe(1280);
		expect(crop.height).toBe(720);
	});

	it("stops reporting a crop after face loss falls back to the full frame", () => {
		const tracker = new CameraFramingTracker();
		const face = [{ xCenter: 0.5, yCenter: 0.3, width: 0.2, height: 0.24 }];
		tracker.updateFaces(face, 0);
		for (let now = 0; now <= 2000; now += 20) {
			if (now % 200 === 0) tracker.updateFaces(face, now);
			tracker.getCrop(1280, 720, now);
		}
		expect(tracker.getNormalizedCrop()).not.toBeNull();

		for (let now = 2000; now <= 8000; now += 20) {
			tracker.getCrop(1280, 720, now);
		}

		expect(tracker.getNormalizedCrop()).toBeNull();

		tracker.setPaused(true);
		tracker.setPaused(false);
		tracker.updateFaces([], 8100);
		tracker.getCrop(1280, 720, 8120);
		tracker.getCrop(1280, 720, 8140);

		expect(tracker.getNormalizedCrop()).toBeNull();
	});
});

describe("CameraFramingProcessor", () => {
	it("loads the constructor from the package's bundled default export", async () => {
		bundledFaceDetector.close.mockClear();
		const processor = new CameraFramingProcessor();

		await processor.process(document.createElement("canvas"), 1280, 720, 0);
		await processor.dispose();

		expect(bundledFaceDetector.close).toHaveBeenCalledOnce();
	});

	it("loads the constructor exposed globally by the browser UMD bundle", async () => {
		bundledFaceDetector.close.mockClear();
		bundledFaceDetector.moduleDefault.FaceDetection = undefined;
		Reflect.set(globalThis, "FaceDetection", bundledFaceDetector.FaceDetection);
		const processor = new CameraFramingProcessor();

		try {
			await processor.process(document.createElement("canvas"), 1280, 720, 0);
			await processor.dispose();
		} finally {
			Reflect.deleteProperty(globalThis, "FaceDetection");
			bundledFaceDetector.moduleDefault.FaceDetection =
				bundledFaceDetector.FaceDetection;
		}

		expect(bundledFaceDetector.close).toHaveBeenCalledOnce();
	});

	it("does not block crop production while detection is in flight", async () => {
		let releaseSend!: () => void;
		const sendPending = new Promise<void>((resolve) => {
			releaseSend = resolve;
		});
		const send = vi.fn(() => sendPending);
		const close = vi.fn().mockResolvedValue(undefined);
		const processor = new CameraFramingProcessor({
			detectorFactory: async () => ({
				close,
				initialize: vi.fn().mockResolvedValue(undefined),
				onResults: vi.fn(),
				send,
				setOptions: vi.fn(),
			}),
			detectionIntervalMs: 0,
		});
		const image = document.createElement("canvas");

		const firstCrop = processor.process(image, 1280, 720, 0);
		await expect(
			Promise.race([
				firstCrop.then(() => "resolved"),
				new Promise((resolve) => setTimeout(() => resolve("pending"), 0)),
			]),
		).resolves.toBe("resolved");
		await processor.process(image, 1280, 720, 1);
		expect(send).toHaveBeenCalledOnce();

		releaseSend();
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 0));
		await processor.process(image, 1280, 720, 2);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await processor.dispose();
		expect(close).toHaveBeenCalledOnce();
	});

	it("limits detection cadence and closes its detector", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const setOptions = vi.fn();
		let onResults: (results: {
			detections: Array<{
				boundingBox: {
					xCenter: number;
					yCenter: number;
					width: number;
					height: number;
				};
			}>;
		}) => void = () => {};
		const processor = new CameraFramingProcessor({
			detectorFactory: async () => ({
				close,
				initialize: vi.fn().mockResolvedValue(undefined),
				onResults: (listener) => {
					onResults = listener;
				},
				send: async (input) => {
					send(input);
					onResults({
						detections: [
							{
								boundingBox: {
									xCenter: 0.5,
									yCenter: 0.3,
									width: 0.2,
									height: 0.24,
								},
							},
						],
					});
				},
				setOptions,
			}),
			detectionIntervalMs: 200,
		});
		const image = document.createElement("canvas");

		await processor.process(image, 1280, 720, 0);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		await processor.process(image, 1280, 720, 100);
		await processor.process(image, 1280, 720, 200);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await processor.dispose();

		expect(send).toHaveBeenCalledTimes(2);
		expect(setOptions).toHaveBeenCalledWith(
			expect.objectContaining({ model: "full" }),
		);
		expect(close).toHaveBeenCalledOnce();
	});

	it("closes a detector that fails to initialize", async () => {
		const close = vi.fn().mockResolvedValue(undefined);
		const processor = new CameraFramingProcessor({
			detectorFactory: async () => ({
				close,
				initialize: vi.fn().mockRejectedValue(new Error("initialization failed")),
				onResults: vi.fn(),
				send: vi.fn(),
				setOptions: vi.fn(),
			}),
		});

		const image = document.createElement("canvas");
		await processor.process(image, 1280, 720, 0);
		await vi.waitFor(async () => {
			await expect(processor.process(image, 1280, 720, 1)).rejects.toThrow(
				"initialization failed",
			);
		});

		expect(close).toHaveBeenCalledOnce();
	});
});
