import {
	createNoiseSuppressionAudioWorklet,
	type NoiseSuppressionAudioWorkletHandle,
} from "@/shims/noise-suppression-audio-worklet";
import { onUnmounted, type Ref, ref } from "vue";

const DTLN_SAMPLE_RATE = 16000;
const CROSSFADE_MS = 50;
const READY_TIMEOUT_MS = 30_000;

interface NoiseCancellationResult {
	stream: MediaStream;
	cleanup: () => void;
}

interface UseNoiseCancellationReturn {
	isProcessing: Ref<boolean>;
	processedStream: Ref<MediaStream | null>;
	error: Ref<string | null>;
	applyNoiseCancellation: (
		inputStream: MediaStream,
	) => Promise<NoiseCancellationResult>;
	stopProcessing: () => void;
}

interface PreloadedWorklet {
	handle: NoiseSuppressionAudioWorkletHandle;
	context: AudioContext;
}

/**
 * Composable for noise cancellation using DTLN (via @workadventure/noise-suppression).
 *
 * DTLN is hard-coded to 16 kHz mono, 512-sample frames. The worklet is
 * loaded on first use (lazy) so it does not consume resources until noise
 * cancellation is actually enabled. On toggle, the raw and denoised branches are crossfaded over 50 ms to
 * avoid an audible click. If preload or apply fails, the caller falls
 * back to the raw stream and `error` is set.
 */
export function useNoiseCancellation(): UseNoiseCancellationReturn {
	const isProcessing = ref<boolean>(false);
	const processedStream = ref<MediaStream | null>(null);
	const error = ref<string | null>(null);

	let preloaded: PreloadedWorklet | null = null;
	let preloadPromise: Promise<PreloadedWorklet | null> | null = null;
	let disposed = false;

	// Active session
	let sessionContext: AudioContext | null = null;
	let sessionRawSource: MediaStreamAudioSourceNode | null = null;
	let sessionDenoiseSource: MediaStreamAudioSourceNode | null = null;
	let sessionDenoiseNode: AudioWorkletNode | null = null;
	let sessionDestination: MediaStreamAudioDestinationNode | null = null;
	let sessionRawGain: GainNode | null = null;
	let sessionDenoiseGain: GainNode | null = null;

	async function preloadWorklet(): Promise<PreloadedWorklet | null> {
		if (preloaded) {
			return preloaded;
		}
		if (preloadPromise) {
			return preloadPromise;
		}

		preloadPromise = (async () => {
			try {
				const context = new AudioContext({ sampleRate: DTLN_SAMPLE_RATE });
				if (context.sampleRate !== DTLN_SAMPLE_RATE) {
					console.warn(
						`[DTLN] AudioContext fell back to ${context.sampleRate}Hz; DTLN will still run at 16kHz internally but the browser will resample.`,
					);
				}

				const handle = await createNoiseSuppressionAudioWorklet(context, {
					threads: false,
					bypassUntilReady: true,
					readyTimeoutMs: READY_TIMEOUT_MS,
				});

				await handle.ready;

				if (disposed) {
					handle.dispose();
					context.close();
					return null;
				}

				preloaded = { handle, context };
				return preloaded;
			} catch (err) {
				console.error("[DTLN] Preload failed:", err);
				error.value =
					err instanceof Error
						? err.message
						: "Failed to initialize noise cancellation";
				return null;
			} finally {
				preloadPromise = null;
			}
		})();

		return preloadPromise;
	}

	function crossfadeTo(
		rawGain: GainNode,
		denoiseGain: GainNode,
		useDenoise: boolean,
	): void {
		const ctx = rawGain.context;
		const now = ctx.currentTime;
		const fadeSec = CROSSFADE_MS / 1000;
		rawGain.gain.cancelScheduledValues(now);
		denoiseGain.gain.cancelScheduledValues(now);
		rawGain.gain.setValueAtTime(rawGain.gain.value, now);
		denoiseGain.gain.setValueAtTime(denoiseGain.gain.value, now);
		rawGain.gain.linearRampToValueAtTime(useDenoise ? 0 : 1, now + fadeSec);
		denoiseGain.gain.linearRampToValueAtTime(useDenoise ? 1 : 0, now + fadeSec);
	}

	async function applyNoiseCancellation(
		inputStream: MediaStream,
	): Promise<NoiseCancellationResult> {
		const audioTrack = inputStream.getAudioTracks()[0];
		if (!audioTrack) {
			return { stream: inputStream, cleanup: () => {} };
		}

		try {
			isProcessing.value = true;
			error.value = null;

			stopProcessing();

			const worklet = await preloadWorklet();
			if (!worklet) {
				isProcessing.value = false;
				return { stream: inputStream, cleanup: () => {} };
			}

			sessionContext = worklet.context;
			if (sessionContext.state === "suspended") {
				await sessionContext.resume();
			}

			sessionRawSource = sessionContext.createMediaStreamSource(inputStream);
			sessionDenoiseSource =
				sessionContext.createMediaStreamSource(inputStream);

			sessionRawGain = sessionContext.createGain();
			sessionRawGain.gain.value = 0;
			sessionDenoiseGain = sessionContext.createGain();
			sessionDenoiseGain.gain.value = 1;

			sessionDenoiseNode = worklet.handle.node;
			sessionDestination = sessionContext.createMediaStreamDestination();

			// Two parallel branches: raw (muted initially) and denoised (live).
			// The denoised branch feeds the worklet; the raw branch is a safety
			// net so a frame or two of audio is always flowing through.
			sessionDenoiseSource.connect(sessionDenoiseNode);
			sessionDenoiseNode.connect(sessionDenoiseGain);
			sessionDenoiseGain.connect(sessionDestination);

			sessionRawSource.connect(sessionRawGain);
			sessionRawGain.connect(sessionDestination);

			crossfadeTo(sessionRawGain, sessionDenoiseGain, true);

			const outputStream = sessionDestination.stream;
			processedStream.value = outputStream;

			return {
				stream: outputStream,
				cleanup: stopProcessing,
			};
		} catch (err) {
			console.error("[DTLN] Failed to apply noise cancellation:", err);
			error.value =
				err instanceof Error
					? err.message
					: "Failed to apply noise cancellation";
			isProcessing.value = false;
			stopProcessing();
			return { stream: inputStream, cleanup: () => {} };
		}
	}

	function stopProcessing(): void {
		isProcessing.value = false;

		for (const node of [
			sessionRawSource,
			sessionDenoiseSource,
			sessionDenoiseNode,
			sessionRawGain,
			sessionDenoiseGain,
			sessionDestination,
		]) {
			if (!node) continue;
			try {
				node.disconnect();
			} catch (e) {
				console.warn("Failed to disconnect node:", e);
			}
		}

		sessionRawSource = null;
		sessionDenoiseSource = null;
		sessionDenoiseNode = null;
		sessionRawGain = null;
		sessionDenoiseGain = null;
		sessionDestination = null;
		sessionContext = null;

		processedStream.value = null;
	}

	onUnmounted(() => {
		disposed = true;
		stopProcessing();
		preloaded?.handle.dispose();
		if (preloaded?.context && preloaded.context.state !== "closed") {
			preloaded.context.close().catch(() => {});
		}
		preloaded = null;
	});

	return {
		isProcessing,
		processedStream,
		error,
		applyNoiseCancellation,
		stopProcessing,
	};
}
