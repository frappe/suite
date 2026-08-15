import type { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import { toast } from "frappe-ui";
import { onUnmounted, type Ref, ref } from "vue";
import { availableBackgroundImages } from "../data/backgroundEffects";
import {
	applyBlurEffect,
	applyVirtualBackground,
	CompositingError,
	getBackgroundImageData,
} from "../utils/compositing";
import { WebGLManager } from "../utils/webglShaders";

// Types and interfaces
export interface BackgroundEffectOptions {
	backgroundBlurEnabled?: boolean;
	backgroundImageEnabled?: boolean;
	selectedBackgroundImage?: string | null;
	blurIntensity?: number;
}

interface BackgroundImage {
	name: string;
	label: string;
	url: string;
	isCustom?: boolean;
	metadata?: {
		size: number;
		width: number;
		height: number;
		format: string;
		createdAt: string;
	};
}

interface BackgroundEffectsResult {
	stream: MediaStream;
	cleanup: () => void;
	updateOptions: (options: BackgroundEffectOptions) => Promise<void>;
}

interface SelfieSegmentationResults {
	segmentationMask: ImageBitmap;
	image?: unknown;
}

interface UseBackgroundEffectsReturn {
	isProcessing: Ref<boolean>;
	processedStream: Ref<MediaStream | null>;
	error: Ref<string | null>;
	applyBackgroundEffects: (
		inputStream: MediaStream,
		options?: BackgroundEffectOptions,
		signal?: AbortSignal,
	) => Promise<BackgroundEffectsResult>;
	stopProcessing: () => void;
	dispose: () => Promise<void>;
	loadModel: () => Promise<SelfieSegmentation>;
}

interface HaltProcessingOptions {
	disposeWebGL?: boolean;
}

interface UseBackgroundEffectsOptions {
	autoCleanupOnUnmount?: boolean;
}

// MediaPipe Selfie Segmentation instance
let selfieSegmentation: SelfieSegmentation | null = null;
let selfieSegmentationCtor:
	| (new (options: {
			locateFile: (file: string) => string;
	  }) => SelfieSegmentation)
	| null = null;
const backgroundImages = new Map<string, HTMLImageElement>();
let latestResults: SelfieSegmentationResults | null = null;
let modelInitializationPromise: Promise<SelfieSegmentation> | null = null;
let modelReleasePromise: Promise<void> | null = null;
let modelFaultPromise: Promise<void> | null = null;
let faultedSegmentation: SelfieSegmentation | null = null;
let activeInstanceCount = 0;

async function getSelfieSegmentationCtor() {
	if (selfieSegmentationCtor) return selfieSegmentationCtor;

	// @mediapipe/selfie_segmentation ships a UMD bundle that exposes a global.
	await import("@mediapipe/selfie_segmentation");

	const ctor = (
		globalThis as typeof globalThis & {
			SelfieSegmentation?: new (options: {
				locateFile: (file: string) => string;
			}) => SelfieSegmentation;
		}
	).SelfieSegmentation;

	if (!ctor) {
		throw new Error("SelfieSegmentation constructor not found on globalThis");
	}

	selfieSegmentationCtor = ctor;
	return ctor;
}

export function useBackgroundEffects({
	autoCleanupOnUnmount = true,
}: UseBackgroundEffectsOptions = {}): UseBackgroundEffectsReturn {
	const isProcessing = ref<boolean>(false);
	const processedStream = ref<MediaStream | null>(null);
	const error = ref<string | null>(null);
	let instanceSessionCounter = 0;
	let activeSessionId = 0;
	let isDisposed = false;
	let disposePromise: Promise<void> | null = null;
	const ownerController = new AbortController();

	activeInstanceCount++;

	let animationId: number | null = null;

	let webglManager: WebGLManager | null = null;

	const defaultOptions: Required<BackgroundEffectOptions> = {
		backgroundBlurEnabled: false,
		backgroundImageEnabled: false,
		selectedBackgroundImage: null,
		blurIntensity: 4,
	};

	const ownerAbort = () =>
		new DOMException(
			"Background effects owner has been disposed",
			"AbortError",
		);
	const operationAbort = (signal: AbortSignal) =>
		signal.reason instanceof Error
			? signal.reason
			: new DOMException(
					"Background effects operation was aborted",
					"AbortError",
				);
	const assertOwnerActive = (signal?: AbortSignal) => {
		if (isDisposed) throw ownerAbort();
		if (signal?.aborted) throw operationAbort(signal);
	};
	const racePendingWork = <T>(
		promise: Promise<T>,
		signal?: AbortSignal,
	): Promise<T> => {
		assertOwnerActive(signal);
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				ownerController.signal.removeEventListener("abort", onOwnerAbort);
				signal?.removeEventListener("abort", onOperationAbort);
			};
			const onOwnerAbort = () => {
				cleanup();
				reject(ownerAbort());
			};
			const onOperationAbort = () => {
				cleanup();
				reject(signal ? operationAbort(signal) : ownerAbort());
			};
			ownerController.signal.addEventListener("abort", onOwnerAbort, {
				once: true,
			});
			signal?.addEventListener("abort", onOperationAbort, { once: true });
			promise.then(
				(value) => {
					cleanup();
					resolve(value);
				},
				(reason) => {
					cleanup();
					reject(reason);
				},
			);
		});
	};

	async function loadModel(signal?: AbortSignal): Promise<SelfieSegmentation> {
		try {
			assertOwnerActive(signal);
			const pendingFault = modelFaultPromise;
			if (pendingFault) {
				await pendingFault;
				assertOwnerActive(signal);
			}
			const pendingRelease = modelReleasePromise;
			if (pendingRelease) {
				await pendingRelease;
				assertOwnerActive(signal);
			}

			if (selfieSegmentation && selfieSegmentation === faultedSegmentation) {
				await invalidateFaultedSegmentation(selfieSegmentation);
				assertOwnerActive(signal);
			}

			if (selfieSegmentation) {
				assertOwnerActive(signal);
				return selfieSegmentation;
			}

			if (!modelInitializationPromise) {
				modelInitializationPromise = (async () => {
					try {
						const SelfieSegmentationCtor = await getSelfieSegmentationCtor();
						const instance = new SelfieSegmentationCtor({
							locateFile: (file) => {
								return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
							},
						});

						instance.setOptions({
							modelSelection: 1, // Use landscape model for better performance
						});

						instance.onResults((results) => {
							latestResults = results as SelfieSegmentationResults;
						});

						try {
							await instance.initialize();
						} catch (initializationError) {
							try {
								await instance.close();
							} catch {}
							selfieSegmentationCtor = null;
							throw initializationError;
						}

						selfieSegmentation = instance;
						latestResults = null;
						return instance;
					} finally {
						modelInitializationPromise = null;
					}
				})();
			}

			const model = await modelInitializationPromise;
			assertOwnerActive(signal);
			return model;
		} catch (err) {
			if (isDisposed || signal?.aborted) {
				assertOwnerActive(signal);
				throw err;
			}
			console.error("Failed to load MediaPipe Selfie Segmentation model:", err);
			error.value = "Failed to load background effects model";
			toast.error(
				"Failed to load the background effects model. Please try again.",
			);
			throw err;
		}
	}

	async function loadBackgroundImage(
		imageUrl: string,
		signal?: AbortSignal,
	): Promise<HTMLImageElement> {
		assertOwnerActive(signal);
		if (backgroundImages.has(imageUrl)) {
			const cached = backgroundImages.get(imageUrl);
			if (cached) {
				assertOwnerActive(signal);
				return cached;
			}
		}

		const img = new Image();
		img.crossOrigin = "anonymous";
		try {
			const loading = new Promise<HTMLImageElement>((resolve, reject) => {
				img.onload = () => {
					backgroundImages.set(imageUrl, img);
					resolve(img);
				};
				img.onerror = (err) => {
					console.error("Failed to load background image:", err);
					reject(err);
				};
				img.src = imageUrl;
			});
			return await racePendingWork(loading, signal);
		} catch (err) {
			if (isDisposed || signal?.aborted) throw err;
			console.error("Failed to load background image:", err);
			throw err;
		} finally {
			if (isDisposed || signal?.aborted) {
				img.onload = null;
				img.onerror = null;
				img.src = "";
			}
		}
	}

	async function applyBackgroundEffects(
		inputStream: MediaStream,
		options: BackgroundEffectOptions = {},
		signal?: AbortSignal,
	): Promise<BackgroundEffectsResult> {
		assertOwnerActive(signal);
		if (!inputStream)
			return {
				stream: inputStream,
				cleanup: () => {},
				updateOptions: async () => {},
			};

		await haltProcessing({ disposeWebGL: false });
		assertOwnerActive(signal);
		// reset segmentation state only if model is not initialized
		// or if there was a previous error
		const shouldReset = !selfieSegmentation || modelInitializationPromise;
		if (shouldReset) {
			const modelToReset = selfieSegmentation;
			const preStartResetSucceeded = await resetSegmentationState(modelToReset);
			assertOwnerActive(signal);
			if (!preStartResetSucceeded && modelToReset) {
				await invalidateFaultedSegmentation(modelToReset);
				assertOwnerActive(signal);
			}
		}

		animationId = null;

		const settings = { ...defaultOptions, ...options };
		if (!settings.selectedBackgroundImage) {
			settings.selectedBackgroundImage = null;
		}

		const shouldContinueProcessing = (
			sessionId: number,
			model: SelfieSegmentation | null,
		): boolean => {
			return (
				isProcessing.value &&
				!signal?.aborted &&
				sessionId === activeSessionId &&
				model === selfieSegmentation
			);
		};
		let trackProcessor: ReadableStreamDefaultReader<VideoFrame> | null = null;
		let video: HTMLVideoElement | null = null;
		let trackGenerator:
			| (MediaStreamTrack & { writable: WritableStream })
			| null = null;
		let trackWriter: WritableStreamDefaultWriter | null = null;
		let processedVideoTrack: MediaStreamTrack | null = null;
		let resultStream: MediaStream | null = null;
		let provisionalResourcesCleaned = false;
		const cleanupProvisionalResources = (): void => {
			if (provisionalResourcesCleaned) return;
			provisionalResourcesCleaned = true;
			if (video) {
				video.srcObject = null;
				video = null;
			}
			if (trackProcessor) {
				try {
					void trackProcessor.cancel().catch(() => {});
				} catch {}
				trackProcessor = null;
			}
			if (trackWriter) {
				try {
					void trackWriter.close().catch(() => {});
				} catch {}
				trackWriter = null;
			}
			const outputTrack = processedVideoTrack;
			if (
				outputTrack &&
				processedStream.value
					?.getVideoTracks()
					.some((track) => track.id === outputTrack.id)
			) {
				processedStream.value = null;
			}
			if (outputTrack && outputTrack.readyState !== "ended") outputTrack.stop();
			processedVideoTrack = null;
			resultStream = null;
			trackGenerator = null;
		};

		try {
			isProcessing.value = true;
			error.value = null;

			if (!webglManager) {
				try {
					const webglCanvas = document.createElement("canvas");
					webglManager = new WebGLManager(webglCanvas);
					webglManager.initializeShaders();
				} catch (error) {
					console.warn("WebGL initialization failed:", error);
					toast.warning(
						"WebGL is not available. Background blur effects will be disabled.",
					);
					webglManager = null;
				}
			}

			let model = await loadModel(signal);
			assertOwnerActive(signal);
			let sessionId = ++instanceSessionCounter;
			activeSessionId = sessionId;
			const videoTrack = inputStream.getVideoTracks()[0];

			if (!videoTrack) {
				isProcessing.value = false;
				return {
					stream: inputStream,
					cleanup: () => {},
					updateOptions: async () => {},
				};
			}

			// Get track settings to determine canvas size
			const trackSettings = videoTrack.getSettings();
			const width = trackSettings.width || 640;
			const height = trackSettings.height || 480;

			// Create canvas for processing
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) throw new Error("Failed to get canvas context");

			canvas.width = width;
			canvas.height = height;

			if ("MediaStreamTrackProcessor" in window) {
				const MediaStreamTrackProcessor = (
					window as typeof window & {
						MediaStreamTrackProcessor: new (init: {
							track: MediaStreamTrack;
						}) => {
							readable: ReadableStream<VideoFrame>;
						};
					}
				).MediaStreamTrackProcessor;
				const processor = new MediaStreamTrackProcessor({ track: videoTrack });
				trackProcessor = processor.readable.getReader();
			} else {
				// Fallback to video element for browsers without MediaStreamTrackProcessor
				video = document.createElement("video");
				video.srcObject = new MediaStream([videoTrack]);
				video.muted = true;
				video.playsInline = true;
				try {
					await racePendingWork(video.play(), signal);
					assertOwnerActive(signal);
				} catch (err) {
					if (isDisposed || signal?.aborted) throw err;
					console.warn("Autoplay prevented, attempting muted playback", err);
				}
			}

			let backgroundImageData: ImageData | null = null;
			let backgroundImageKey: string | null = null;
			let backgroundImageUpdatePromise: Promise<void> | null = null;

			const loadBackgroundImageData = async (
				selectedKey: string,
			): Promise<void> => {
				let bgImage: BackgroundImage | null = null;
				const predefinedImages = availableBackgroundImages;
				bgImage =
					predefinedImages.find((img) => img.name === selectedKey) || null;

				if (!bgImage) {
					const { customBackgroundImages } = await import(
						"../data/backgroundEffects"
					);
					assertOwnerActive(signal);
					const customImage = customBackgroundImages.value.find(
						(img: BackgroundImage) => img.name === selectedKey,
					);
					if (customImage) {
						bgImage = customImage;
					}
				}

				if (!bgImage) {
					throw new Error(`Background image not found for key: ${selectedKey}`);
				}

				const img = await loadBackgroundImage(bgImage.url, signal);
				assertOwnerActive(signal);
				backgroundImageData = getBackgroundImageData(
					img,
					canvas.width,
					canvas.height,
				);
				backgroundImageKey = selectedKey;
			};

			const ensureBackgroundImage = () => {
				if (!settings.backgroundImageEnabled) {
					backgroundImageData = null;
					backgroundImageKey = null;
					return Promise.resolve();
				}

				const selectedKey = settings.selectedBackgroundImage;
				if (!selectedKey) {
					backgroundImageData = null;
					backgroundImageKey = null;
					return Promise.resolve();
				}

				if (
					backgroundImageKey === selectedKey &&
					backgroundImageData &&
					backgroundImageData.width === canvas.width &&
					backgroundImageData.height === canvas.height
				) {
					return Promise.resolve();
				}

				backgroundImageUpdatePromise = (
					backgroundImageUpdatePromise
						? backgroundImageUpdatePromise.catch(() => undefined)
						: Promise.resolve()
				).then(() => loadBackgroundImageData(selectedKey));
				return backgroundImageUpdatePromise;
			};

			await ensureBackgroundImage();
			assertOwnerActive(signal);

			// Create output canvas - use OffscreenCanvas only if MediaStreamTrackGenerator is available
			// Otherwise use HTMLCanvasElement for captureStream() compatibility
			// Firefox doesn't support MediaStreamTrackGenerator yet
			// This is a workaround to keep processing active when tab view is hidden
			const useOffscreenCanvas =
				typeof OffscreenCanvas !== "undefined" &&
				"MediaStreamTrackGenerator" in window;

			const outputCanvas = useOffscreenCanvas
				? new OffscreenCanvas(canvas.width, canvas.height)
				: document.createElement("canvas");
			const outputCtx = outputCanvas.getContext("2d", {
				willReadFrequently: true,
			});
			if (!outputCtx) throw new Error("Failed to get output canvas context");

			if (outputCanvas instanceof HTMLCanvasElement) {
				outputCanvas.width = canvas.width;
				outputCanvas.height = canvas.height;
			}

			// Helper to apply background effects (blur or virtual background)
			const applyEffectsToFrame = async (maskBitmap: ImageBitmap) => {
				if (settings.backgroundBlurEnabled) {
					if (webglManager) {
						try {
							const resultCanvas = applyBlurEffect(
								canvas,
								maskBitmap,
								canvas.width,
								canvas.height,
								{
									blurIntensity: settings.blurIntensity,
									webglManager,
								},
							);
							outputCtx.drawImage(resultCanvas, 0, 0);
						} catch (error) {
							if (
								error instanceof CompositingError &&
								error.code === "WEBGL_UNAVAILABLE"
							) {
								toast.error(
									"Background blur requires WebGL but it's not available on this device. Blur effects have been disabled.",
								);
								settings.backgroundBlurEnabled = false;
							} else if (
								error instanceof CompositingError &&
								error.code === "WEBGL_BLUR_FAILED"
							) {
								toast.error(
									"Background blur failed due to WebGL error. Blur effects have been disabled.",
								);
								settings.backgroundBlurEnabled = false;
							} else {
								console.error("Blur effect failed:", error);
							}
							outputCtx.drawImage(canvas, 0, 0);
						}
					} else {
						outputCtx.drawImage(canvas, 0, 0);
					}
				} else if (backgroundImageData) {
					if (webglManager) {
						try {
							const resultCanvas = applyVirtualBackground(
								canvas,
								maskBitmap,
								backgroundImageData,
								{
									webglManager,
								},
							);
							outputCtx.drawImage(resultCanvas, 0, 0);
						} catch (error) {
							console.warn(
								"Virtual background WebGL failed, disabling:",
								error,
							);
							backgroundImageData = null;
							outputCtx.drawImage(canvas, 0, 0);
						}
					} else {
						outputCtx.drawImage(canvas, 0, 0);
					}
				} else {
					outputCtx.drawImage(canvas, 0, 0);
				}

				if (trackWriter && outputCanvas instanceof OffscreenCanvas) {
					let bitmap: ImageBitmap | null = null;
					let videoFrame: VideoFrame | null = null;
					try {
						bitmap = outputCanvas.transferToImageBitmap();
						videoFrame = new VideoFrame(bitmap, {
							timestamp: performance.now() * 1000, // convert to microseconds
						});
						await trackWriter.write(videoFrame);
						assertOwnerActive(signal);
					} catch (err) {
						if (isDisposed || signal?.aborted) return;
						console.warn("Failed to write VideoFrame:", err);
					} finally {
						if (videoFrame) videoFrame.close();
						if (bitmap) bitmap.close();
					}
				}
			};

			const processFrame = async () => {
				if (trackProcessor) {
					while (shouldContinueProcessing(sessionId, model)) {
						let videoFrame: VideoFrame | null = null;
						try {
							const result = await trackProcessor.read();
							assertOwnerActive(signal);
							if (result.done || !result.value) {
								break;
							}
							videoFrame = result.value;

							const bitmap = await createImageBitmap(videoFrame, {
								resizeWidth: canvas.width,
								resizeHeight: canvas.height,
							});
							assertOwnerActive(signal);
							ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
							bitmap.close();

							await model.send({ image: canvas });
							assertOwnerActive(signal);

							videoFrame.close();
							videoFrame = null;

							if (!shouldContinueProcessing(sessionId, model)) {
								break;
							}

							const results = latestResults;
							if (!results?.segmentationMask) {
								outputCtx.clearRect(
									0,
									0,
									outputCanvas.width,
									outputCanvas.height,
								);
								outputCtx.drawImage(canvas, 0, 0);
								continue;
							}

							outputCtx.clearRect(
								0,
								0,
								outputCanvas.width,
								outputCanvas.height,
							);
							await applyEffectsToFrame(results.segmentationMask);
							assertOwnerActive(signal);
						} catch (err) {
							if (videoFrame) videoFrame.close();
							if (isDisposed || signal?.aborted) break;
							console.error("Frame processing error:", err);

							const errorName = err instanceof Error ? err.name : "";
							const errorMessage =
								err instanceof Error ? err.message : String(err);
							const isFatalError =
								errorName === "RuntimeError" ||
								errorName === "BindingError" ||
								errorMessage.includes("RuntimeError") ||
								errorMessage.includes("BindingError") ||
								errorMessage.includes("index out of bounds");

							if (isFatalError) {
								try {
									const resetSucceeded = await resetSegmentationState(model);
									assertOwnerActive(signal);
									if (!resetSucceeded) {
										await invalidateFaultedSegmentation(model);
										assertOwnerActive(signal);
									}
									model = await loadModel(signal);
									assertOwnerActive(signal);
									sessionId = ++instanceSessionCounter;
									activeSessionId = sessionId;
								} catch (recoveryError) {
									if (isDisposed || signal?.aborted) break;
									console.error(
										"Failed to recover from frame error:",
										recoveryError,
									);
									await haltProcessing();
									break;
								}
							}
						}
					}
				} else {
					await processFrameWithRAF();
				}
			};

			let lastFrameTime = 0;
			const targetFrameRate = 1000 / 30; // 30 FPS

			const processFrameWithRAF = async (currentTime = 0) => {
				try {
					if (!shouldContinueProcessing(sessionId, model)) {
						return;
					}

					// skip frames if we're processing too fast
					if (currentTime - lastFrameTime < targetFrameRate) {
						animationId = requestAnimationFrame(processFrameWithRAF);
						return;
					}
					lastFrameTime = currentTime;

					if (
						!video ||
						video.videoWidth === 0 ||
						video.videoHeight === 0 ||
						video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
					) {
						animationId = requestAnimationFrame(processFrameWithRAF);
						return;
					}
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

					await model.send({ image: canvas });
					assertOwnerActive(signal);

					if (!shouldContinueProcessing(sessionId, model)) {
						return;
					}

					const results = latestResults;
					if (!results?.segmentationMask) {
						outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
						outputCtx.drawImage(canvas, 0, 0);
						animationId = requestAnimationFrame(processFrameWithRAF);
						return;
					}

					// clear output canvas
					outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
					await applyEffectsToFrame(results.segmentationMask);
					assertOwnerActive(signal);

					if (isProcessing.value) {
						animationId = requestAnimationFrame(processFrameWithRAF);
					}
				} catch (err) {
					if (isDisposed || signal?.aborted) return;
					console.error("Frame processing error:", err);

					if (!isProcessing.value) {
						return;
					}

					const errorName = err instanceof Error ? err.name : "";
					const errorMessage = err instanceof Error ? err.message : String(err);
					const isFatalError =
						errorName === "RuntimeError" ||
						errorName === "BindingError" ||
						errorMessage.includes("RuntimeError") ||
						errorMessage.includes("BindingError") ||
						errorMessage.includes("index out of bounds");

					if (isFatalError) {
						try {
							const resetSucceeded = await resetSegmentationState(model);
							assertOwnerActive(signal);
							if (!resetSucceeded) {
								await invalidateFaultedSegmentation(model);
								assertOwnerActive(signal);
							}
							model = await loadModel(signal);
							assertOwnerActive(signal);
							sessionId = ++instanceSessionCounter;
							activeSessionId = sessionId;
						} catch (recoveryError) {
							if (isDisposed || signal?.aborted) return;
							console.error(
								"Failed to recover from frame error:",
								recoveryError,
							);
							await haltProcessing();
							return;
						}

						if (isProcessing.value) {
							animationId = requestAnimationFrame(processFrameWithRAF);
						}
						return;
					}

					outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
					outputCtx.drawImage(canvas, 0, 0);

					animationId = requestAnimationFrame(processFrameWithRAF);
				}
			};

			// Start processing
			processFrame();

			let outputStream: MediaStream;
			if (useOffscreenCanvas) {
				const MediaStreamTrackGenerator = (
					window as typeof window & {
						MediaStreamTrackGenerator: new (init: {
							kind: string;
						}) => MediaStreamTrack & {
							writable: WritableStream;
						};
					}
				).MediaStreamTrackGenerator;
				trackGenerator = new MediaStreamTrackGenerator({ kind: "video" });
				trackWriter = trackGenerator.writable.getWriter();
				outputStream = new MediaStream([trackGenerator]);
			} else {
				outputStream = (outputCanvas as HTMLCanvasElement).captureStream(30); // 30 FPS
			}

			// Replace video track
			processedVideoTrack = outputStream.getVideoTracks()[0];
			const newStream = new MediaStream([processedVideoTrack]);
			resultStream = newStream;

			processedStream.value = newStream;

			// Cleanup function
			const cleanup = (): void => {
				isProcessing.value = false;
				cleanupProvisionalResources();
				void haltProcessing({ disposeWebGL: true });
			};

			const updateOptions = async (
				updatedOptions: BackgroundEffectOptions = {},
			): Promise<void> => {
				if (!isProcessing.value) {
					return;
				}

				const normalizedOptions: BackgroundEffectOptions = {
					...updatedOptions,
				};
				if (
					"selectedBackgroundImage" in normalizedOptions &&
					normalizedOptions.selectedBackgroundImage === ""
				) {
					normalizedOptions.selectedBackgroundImage = null;
				}

				if (Object.keys(normalizedOptions).length === 0) {
					return;
				}

				Object.assign(settings, normalizedOptions);

				if (
					"backgroundImageEnabled" in normalizedOptions ||
					"selectedBackgroundImage" in normalizedOptions
				) {
					try {
						await ensureBackgroundImage();
						assertOwnerActive(signal);
					} catch (error) {
						if (isDisposed || signal?.aborted) throw error;
						console.error("Failed to update background image:", error);
						toast.error(
							"Failed to update the selected background image. Reverting to original.",
						);
						settings.backgroundImageEnabled = false;
						settings.selectedBackgroundImage = null;
						backgroundImageData = null;
					}
				}
			};

			assertOwnerActive(signal);
			return { stream: newStream, cleanup, updateOptions };
		} catch (err) {
			cleanupProvisionalResources();
			if (signal?.aborted || isDisposed) {
				await haltProcessing({ disposeWebGL: true });
				assertOwnerActive(signal);
			}
			console.error("Background effects processing error:", err);
			error.value = err instanceof Error ? err.message : "Unknown error";
			toast.error("Failed to apply background effects. Using original video.");
			await haltProcessing({ disposeWebGL: true });
			await resetSegmentationState();
			return {
				stream: inputStream,
				cleanup: () => {},
				updateOptions: async () => {},
			};
		}
	}

	// Gracefully stop the current processing loop and wait for in-flight operations
	async function haltProcessing(
		options: HaltProcessingOptions = {},
	): Promise<void> {
		const { disposeWebGL = false } = options;
		if (!isProcessing.value && !processedStream.value && !animationId) {
			if (disposeWebGL && webglManager) {
				webglManager.dispose();
				webglManager = null;
			}
			return;
		}

		isProcessing.value = false;
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}

		if (processedStream.value) {
			for (const track of processedStream.value.getTracks()) {
				track.stop();
			}
			processedStream.value = null;
		}

		if (disposeWebGL && webglManager) {
			webglManager.dispose();
			webglManager = null;
		}

		// Clear cached results so the next run starts fresh
		latestResults = null;
	}

	function stopProcessing(): void {
		void haltProcessing();
	}

	async function resetSegmentationState(
		model: SelfieSegmentation | null = selfieSegmentation,
	): Promise<boolean> {
		if (!model) {
			return true;
		}

		latestResults = null;
		const resetFn = Reflect.get(model, "reset") as (() => void) | undefined;
		if (typeof resetFn === "function") {
			try {
				resetFn.call(model);
				return true;
			} catch (err) {
				console.warn("Failed to reset MediaPipe instance:", err);
			}
		}

		return false;
	}

	async function invalidateFaultedSegmentation(
		model: SelfieSegmentation,
	): Promise<void> {
		const pendingFault = modelFaultPromise;
		if (pendingFault) {
			await pendingFault;
			if (modelFaultPromise === pendingFault) modelFaultPromise = null;
		}
		if (selfieSegmentation !== model) return;
		faultedSegmentation = model;

		const invalidation = (async () => {
			const pendingRelease = modelReleasePromise;
			if (pendingRelease) await pendingRelease;
			if (selfieSegmentation !== model) return;
			await model.close();
			if (selfieSegmentation === model) {
				selfieSegmentation = null;
				selfieSegmentationCtor = null;
				latestResults = null;
			}
			if (faultedSegmentation === model) faultedSegmentation = null;
		})();
		modelFaultPromise = invalidation;
		void invalidation.then(
			() => {
				if (modelFaultPromise === invalidation) modelFaultPromise = null;
			},
			() => {
				if (modelFaultPromise === invalidation) modelFaultPromise = null;
			},
		);
		return invalidation;
	}

	async function releaseSegmentation(): Promise<void> {
		if (modelReleasePromise) return modelReleasePromise;

		const release = (async () => {
			if (activeInstanceCount !== 0) return;
			const pendingFault = modelFaultPromise;
			if (pendingFault) {
				try {
					await pendingFault;
				} catch {}
				if (activeInstanceCount !== 0) return;
			}
			if (!selfieSegmentation && modelInitializationPromise) {
				try {
					await modelInitializationPromise;
				} catch {
					return;
				}
				if (activeInstanceCount !== 0) return;
			}

			const model = selfieSegmentation;
			if (!model || activeInstanceCount !== 0) return;
			let closed = false;
			try {
				if (activeInstanceCount !== 0) return;
				await model.close();
				closed = true;
			} catch (closeError) {
				console.warn("Failed to close MediaPipe instance:", closeError);
			}
			if (closed && selfieSegmentation === model) {
				selfieSegmentation = null;
				selfieSegmentationCtor = null;
				latestResults = null;
			}
			if (closed && faultedSegmentation === model) {
				faultedSegmentation = null;
			}
		})();
		modelReleasePromise = release;
		void release.finally(() => {
			if (modelReleasePromise === release) modelReleasePromise = null;
		});
		return release;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		isDisposed = true;
		ownerController.abort(ownerAbort());
		activeInstanceCount = Math.max(0, activeInstanceCount - 1);
		disposePromise = (async () => {
			await haltProcessing({ disposeWebGL: true });
			if (activeInstanceCount === 0) {
				await releaseSegmentation();
			}
		})();
		return disposePromise;
	}

	onUnmounted(() => {
		if (!autoCleanupOnUnmount) return;
		void dispose();
	});

	return {
		isProcessing,
		processedStream,
		error,
		applyBackgroundEffects,
		stopProcessing,
		dispose,
		loadModel,
	};
}
