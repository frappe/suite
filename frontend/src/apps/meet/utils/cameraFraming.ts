import type {
	Detection,
	FaceDetection,
	InputImage,
	Results,
} from "@mediapipe/face_detection";

export interface NormalizedFaceBox {
	xCenter: number;
	yCenter: number;
	width: number;
	height: number;
}

export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface NormalizedCrop {
	x: number;
	y: number;
	size: number;
}

interface FaceDetectorLike {
	close(): Promise<void>;
	initialize(): Promise<void>;
	onResults(listener: (results: Results) => void): void;
	send(inputs: { image: InputImage }): Promise<void>;
	setOptions(options: {
		selfieMode?: boolean;
		model?: string;
		minDetectionConfidence?: number;
	}): void;
}

interface CameraFramingProcessorOptions {
	detectorFactory?: () => Promise<FaceDetectorLike>;
	detectionIntervalMs?: number;
}

type DetectionImageSource = InputImage | (() => InputImage);

const FULL_FRAME: NormalizedCrop = { x: 0, y: 0, size: 1 };
const FACE_HOLD_MS = 1500;
const SMOOTHING_TIME_MS = 420;
const CENTER_DEAD_ZONE = 0.035;
const SIZE_DEAD_ZONE = 0.05;
const SIZE_CONFIRMATION_SAMPLES = 5;
const CROP_CONVERGENCE_EPSILON = 0.02;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

/**
 * Converts face detections into a smooth, bounded square crop. Call `getCrop`
 * for every frame; pausing freezes the exact current crop until resumed.
 */
export class CameraFramingTracker {
	private current = { ...FULL_FRAME };
	private target = { ...FULL_FRAME };
	private lastFaceAt: number | null = null;
	private lastFrameAt: number | null = null;
	private pendingSize = 0;
	private pendingSizeDirection = 0;
	private pendingSizeSamples = 0;
	private paused = false;
	private enabled = true;
	private awaitingResumeDetection = false;
	private hasTrackedFace = false;
	private hasAcquiredCrop = false;

	private resetPendingSize(): void {
		this.pendingSize = 0;
		this.pendingSizeDirection = 0;
		this.pendingSizeSamples = 0;
	}

	updateFaces(faces: NormalizedFaceBox[], now: number): void {
		if (this.paused || !this.enabled) return;
		const wasAwaitingResumeDetection = this.awaitingResumeDetection;
		this.awaitingResumeDetection = false;
		const face = faces.reduce<NormalizedFaceBox | null>((largest, candidate) => {
			if (!largest) return candidate;
			return candidate.width * candidate.height > largest.width * largest.height
				? candidate
				: largest;
		}, null);
		if (!face) {
			if (wasAwaitingResumeDetection && this.hasAcquiredCrop) {
				this.lastFaceAt = now;
			}
			return;
		}

		const detectedSize = clamp(
			Math.max(face.width * 2.8, face.height * 3.4),
			0.38,
			1,
		);
		const previousCenterX = this.target.x + this.target.size / 2;
		const previousCenterY = this.target.y + this.target.size / 2;
		let size = this.target.size;
		if (this.lastFaceAt === null || wasAwaitingResumeDetection) {
			size = detectedSize;
			this.resetPendingSize();
		} else {
			const sizeDelta = detectedSize - this.target.size;
			if (Math.abs(sizeDelta) < SIZE_DEAD_ZONE) {
				this.resetPendingSize();
			} else {
				const direction = Math.sign(sizeDelta);
				if (direction !== this.pendingSizeDirection) {
					this.pendingSize = detectedSize;
					this.pendingSizeDirection = direction;
					this.pendingSizeSamples = 1;
				} else {
					this.pendingSize = (this.pendingSize + detectedSize) / 2;
					this.pendingSizeSamples++;
				}
				if (this.pendingSizeSamples >= SIZE_CONFIRMATION_SAMPLES) {
					size = this.pendingSize;
					this.resetPendingSize();
				}
			}
		}
		const detectedCenterX = clamp(face.xCenter, size / 2, 1 - size / 2);
		const detectedCenterY = clamp(
			face.yCenter + size * 0.08,
			size / 2,
			1 - size / 2,
		);
		const centerX =
			Math.abs(detectedCenterX - previousCenterX) >= CENTER_DEAD_ZONE
				? detectedCenterX
				: previousCenterX;
		const centerY =
			Math.abs(detectedCenterY - previousCenterY) >= CENTER_DEAD_ZONE
				? detectedCenterY
				: previousCenterY;
		this.target = {
			x: centerX - size / 2,
			y: centerY - size / 2,
			size,
		};
		this.lastFaceAt = now;
		this.hasTrackedFace = true;
	}

	getCrop(sourceWidth: number, sourceHeight: number, now: number): CropRect {
		if (this.paused || this.awaitingResumeDetection) {
			this.lastFrameAt = now;
			return this.toCropRect(sourceWidth, sourceHeight);
		}
		if (this.lastFaceAt === null || now - this.lastFaceAt > FACE_HOLD_MS) {
			this.target = { ...FULL_FRAME };
			this.lastFaceAt = null;
			this.hasAcquiredCrop = false;
			this.resetPendingSize();
		}

		const elapsed = this.lastFrameAt === null ? 16 : Math.max(0, now - this.lastFrameAt);
		const blend = 1 - Math.exp(-elapsed / SMOOTHING_TIME_MS);
		this.current.x += (this.target.x - this.current.x) * blend;
		this.current.y += (this.target.y - this.current.y) * blend;
		this.current.size += (this.target.size - this.current.size) * blend;
		this.lastFrameAt = now;
		const maxDrift = Math.max(
			Math.abs(this.target.x - this.current.x),
			Math.abs(this.target.y - this.current.y),
			Math.abs(this.target.size - this.current.size),
		);
		if (
			this.hasTrackedFace &&
			this.lastFaceAt !== null &&
			maxDrift <= CROP_CONVERGENCE_EPSILON
		) {
			this.hasAcquiredCrop = true;
		}

		return this.toCropRect(sourceWidth, sourceHeight);
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		this.awaitingResumeDetection = !paused && this.enabled;
		this.resetPendingSize();
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (enabled) return;
		this.paused = false;
		this.awaitingResumeDetection = false;
		this.target = { ...FULL_FRAME };
		this.lastFaceAt = null;
		this.hasAcquiredCrop = false;
		this.resetPendingSize();
	}

	getNormalizedCrop(): NormalizedCrop | null {
		return this.hasAcquiredCrop ? { ...this.current } : null;
	}

	isAtFullFrame(): boolean {
		return (
			!this.enabled &&
			Math.max(
				Math.abs(this.current.x),
				Math.abs(this.current.y),
				Math.abs(1 - this.current.size),
			) <= CROP_CONVERGENCE_EPSILON
		);
	}

	restoreCrop(crop: NormalizedCrop): void {
		const size = clamp(crop.size, 0, 1);
		this.current = {
			x: clamp(crop.x, 0, 1 - size),
			y: clamp(crop.y, 0, 1 - size),
			size,
		};
		this.target = { ...this.current };
		this.lastFaceAt = null;
		this.lastFrameAt = null;
		this.hasTrackedFace = true;
		this.hasAcquiredCrop = true;
		this.resetPendingSize();
	}

	private toCropRect(sourceWidth: number, sourceHeight: number): CropRect {
		const width = clamp(this.current.size, 0, 1) * sourceWidth;
		const height = clamp(this.current.size, 0, 1) * sourceHeight;
		return {
			x: clamp(this.current.x * sourceWidth, 0, sourceWidth - width),
			y: clamp(this.current.y * sourceHeight, 0, sourceHeight - height),
			width,
			height,
		};
	}

	reset(): void {
		this.current = { ...FULL_FRAME };
		this.target = { ...FULL_FRAME };
		this.lastFaceAt = null;
		this.lastFrameAt = null;
		this.paused = false;
		this.enabled = true;
		this.awaitingResumeDetection = false;
		this.hasTrackedFace = false;
		this.hasAcquiredCrop = false;
		this.resetPendingSize();
	}
}

async function createFaceDetector(): Promise<FaceDetectorLike> {
	const faceDetectionModule = (await import(
		"@mediapipe/face_detection"
	)) as typeof import("@mediapipe/face_detection") & {
		default?: { FaceDetection?: typeof FaceDetection };
	};
	let namedConstructor: typeof FaceDetection | undefined;
	try {
		namedConstructor = Reflect.get(faceDetectionModule, "FaceDetection") as
			| typeof FaceDetection
			| undefined;
	} catch {}
	const FaceDetectionConstructor =
		faceDetectionModule.default?.FaceDetection ??
		namedConstructor ??
		(Reflect.get(globalThis, "FaceDetection") as
			| typeof FaceDetection
			| undefined);
	if (!FaceDetectionConstructor) {
		throw new Error("FaceDetection constructor not found");
	}
	const detector: FaceDetection = new FaceDetectionConstructor({
		locateFile: (file) =>
			`https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/${file}`,
	});
	return detector;
}

/**
 * Owns a lazily initialized face detector and applies its detections to a crop
 * tracker at a limited cadence. Call `dispose` when the processing session ends.
 */
export class CameraFramingProcessor {
	private readonly tracker = new CameraFramingTracker();
	private readonly detectorFactory: () => Promise<FaceDetectorLike>;
	private readonly detectionIntervalMs: number;
	private detector: FaceDetectorLike | null = null;
	private detectorPromise: Promise<FaceDetectorLike> | null = null;
	private detectionPromise: Promise<void> | null = null;
	private detectionError: unknown = null;
	private detectionGeneration = 0;
	private detections: Detection[] = [];
	private nextDetectionAt = 0;
	private disposed = false;
	private paused = false;
	private enabled = true;

	constructor({
		detectorFactory = createFaceDetector,
		detectionIntervalMs = 200,
	}: CameraFramingProcessorOptions = {}) {
		this.detectorFactory = detectorFactory;
		this.detectionIntervalMs = detectionIntervalMs;
	}

	private async getDetector(): Promise<FaceDetectorLike> {
		if (this.disposed) throw new DOMException("Camera framing stopped", "AbortError");
		if (this.detector) return this.detector;
		if (!this.detectorPromise) {
			this.detectorPromise = this.detectorFactory().then(async (detector) => {
				try {
					detector.setOptions({
						selfieMode: false,
						model: "full",
						minDetectionConfidence: 0.55,
					});
					detector.onResults((results) => {
						this.detections = results.detections;
					});
					await detector.initialize();
					if (this.disposed) {
						throw new DOMException("Camera framing stopped", "AbortError");
					}
					this.detector = detector;
					return detector;
				} catch (error) {
					await detector.close().catch(() => {});
					throw error;
				}
			});
		}
		return this.detectorPromise;
	}

	async process(
		image: DetectionImageSource,
		sourceWidth: number,
		sourceHeight: number,
		now: number,
	): Promise<CropRect> {
		if (this.detectionError) {
			const error = this.detectionError;
			this.detectionError = null;
			throw error;
		}
		if (
			this.enabled &&
			!this.paused &&
			!this.detectionPromise &&
			now >= this.nextDetectionAt
		) {
			this.nextDetectionAt = now + this.detectionIntervalMs;
			const generation = this.detectionGeneration;
			const input = typeof image === "function" ? image() : image;
			const detection = (async () => {
				const detector = await this.getDetector();
				if (this.disposed || this.paused || generation !== this.detectionGeneration) {
					return;
				}
				await detector.send({ image: input });
				if (this.disposed || this.paused || generation !== this.detectionGeneration) {
					return;
				}
				this.tracker.updateFaces(
					this.detections.map(({ boundingBox }) => boundingBox),
					now,
				);
			})();
			this.detectionPromise = detection;
			void detection
				.catch((error) => {
					if (!this.disposed) this.detectionError = error;
				})
				.finally(() => {
					if (this.detectionPromise === detection) this.detectionPromise = null;
				});
		}
		return this.tracker.getCrop(sourceWidth, sourceHeight, now);
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		this.detectionGeneration++;
		this.tracker.setPaused(paused);
		if (!paused) this.nextDetectionAt = 0;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.tracker.setEnabled(enabled);
	}

	getNormalizedCrop(): NormalizedCrop | null {
		return this.tracker.getNormalizedCrop();
	}

	isAtFullFrame(): boolean {
		return this.tracker.isAtFullFrame();
	}

	restoreCrop(crop: NormalizedCrop): void {
		this.tracker.restoreCrop(crop);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.detectionGeneration++;
		this.tracker.reset();
		await this.detectionPromise?.catch(() => {});
		const pending = this.detectorPromise;
		if (pending) {
			try {
				const detector = await pending;
				if (this.detector === detector) await detector.close();
			} catch {}
		}
		this.detector = null;
		this.detectorPromise = null;
	}
}
