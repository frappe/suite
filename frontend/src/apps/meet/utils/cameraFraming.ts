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

interface NormalizedCrop {
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

const FULL_FRAME: NormalizedCrop = { x: 0, y: 0, size: 1 };
const FACE_HOLD_MS = 1500;
const SMOOTHING_TIME_MS = 420;
const CENTER_DEAD_ZONE = 0.035;
const SIZE_DEAD_ZONE = 0.05;
const SIZE_CONFIRMATION_SAMPLES = 5;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export class CameraFramingTracker {
	private current = { ...FULL_FRAME };
	private target = { ...FULL_FRAME };
	private lastFaceAt: number | null = null;
	private lastFrameAt: number | null = null;
	private pendingSize = 0;
	private pendingSizeDirection = 0;
	private pendingSizeSamples = 0;
	private paused = false;

	private resetPendingSize(): void {
		this.pendingSize = 0;
		this.pendingSizeDirection = 0;
		this.pendingSizeSamples = 0;
	}

	updateFaces(faces: NormalizedFaceBox[], now: number): void {
		if (this.paused) return;
		const face = faces.reduce<NormalizedFaceBox | null>((largest, candidate) => {
			if (!largest) return candidate;
			return candidate.width * candidate.height > largest.width * largest.height
				? candidate
				: largest;
		}, null);
		if (!face) return;

		const detectedSize = clamp(
			Math.max(face.width * 2.8, face.height * 3.4),
			0.38,
			1,
		);
		const previousCenterX = this.target.x + this.target.size / 2;
		const previousCenterY = this.target.y + this.target.size / 2;
		let size = this.target.size;
		if (this.lastFaceAt === null) {
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
	}

	getCrop(sourceWidth: number, sourceHeight: number, now: number): CropRect {
		if (this.paused) {
			return this.toCropRect(sourceWidth, sourceHeight);
		}
		if (this.lastFaceAt === null || now - this.lastFaceAt > FACE_HOLD_MS) {
			this.target = { ...FULL_FRAME };
			this.lastFaceAt = null;
			this.resetPendingSize();
		}

		const elapsed = this.lastFrameAt === null ? 16 : Math.max(0, now - this.lastFrameAt);
		const blend = 1 - Math.exp(-elapsed / SMOOTHING_TIME_MS);
		this.current.x += (this.target.x - this.current.x) * blend;
		this.current.y += (this.target.y - this.current.y) * blend;
		this.current.size += (this.target.size - this.current.size) * blend;
		this.lastFrameAt = now;

		return this.toCropRect(sourceWidth, sourceHeight);
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		this.resetPendingSize();
		if (!paused) this.lastFaceAt = null;
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

export class CameraFramingProcessor {
	private readonly tracker = new CameraFramingTracker();
	private readonly detectorFactory: () => Promise<FaceDetectorLike>;
	private readonly detectionIntervalMs: number;
	private detector: FaceDetectorLike | null = null;
	private detectorPromise: Promise<FaceDetectorLike> | null = null;
	private detections: Detection[] = [];
	private nextDetectionAt = 0;
	private disposed = false;
	private paused = false;

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
		image: InputImage,
		sourceWidth: number,
		sourceHeight: number,
		now: number,
	): Promise<CropRect> {
		if (!this.paused && now >= this.nextDetectionAt) {
			const detector = await this.getDetector();
			await detector.send({ image });
			if (this.disposed) {
				throw new DOMException("Camera framing stopped", "AbortError");
			}
			this.tracker.updateFaces(
				this.detections.map(({ boundingBox }) => boundingBox),
				now,
			);
			this.nextDetectionAt = now + this.detectionIntervalMs;
		}
		return this.tracker.getCrop(sourceWidth, sourceHeight, now);
	}

	setPaused(paused: boolean): void {
		this.paused = paused;
		this.tracker.setPaused(paused);
		if (!paused) this.nextDetectionAt = 0;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.tracker.reset();
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
