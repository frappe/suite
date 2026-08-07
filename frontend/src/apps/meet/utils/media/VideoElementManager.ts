/**
 * Video Element Manager
 *
 * Manages video and audio elements for participants.
 */
import { selectedSpeakerId } from "../../data/mediaPreferences";

interface DeferredAttachment {
	stream: MediaStream;
	isLocal: boolean;
	resolve?: () => void;
	reject?: (error: unknown) => void;
	timer?: ReturnType<typeof setTimeout>;
}

const STALE_REATTACH_MS = 60_000;

export class VideoElementManager {
	videoElements: Map<string, HTMLVideoElement>;
	audioElements: Map<string, HTMLAudioElement>;
	deferredAttachments: Map<string, DeferredAttachment>;
	private lastVideoAttachAt: Map<string, number>;
	private lastAudioAttachAt: Map<string, number>;

	constructor(private strictAttachmentTimeoutMs?: number) {
		this.videoElements = new Map();
		this.audioElements = new Map();
		this.deferredAttachments = new Map();
		this.lastVideoAttachAt = new Map();
		this.lastAudioAttachAt = new Map();
	}

	registerVideoElement(participantId: string, element: HTMLElement): void {
		if (!element || !participantId) return;

		const videoEl = element as HTMLVideoElement;
		const previousElement = this.videoElements.get(participantId);
		const previousVideoStream =
			previousElement?.srcObject as MediaStream | null;

		// Only update srcObject if element doesn't have one, or if we're re-registering with a different track
		if (previousVideoStream && !videoEl.srcObject) {
			console.log("Preserving stream during video element re-registration", {
				participantId,
				streamId: previousVideoStream.id,
				trackCount: previousVideoStream.getTracks().length,
			});

			const videoTracks = previousVideoStream.getVideoTracks();
			if (videoTracks.length > 0) {
				const previousVideoTrack = videoTracks[0];
				const existingVideoTrack = (
					videoEl.srcObject as MediaStream
				)?.getVideoTracks?.()?.[0];
				const videoTrackChanged =
					!existingVideoTrack ||
					existingVideoTrack.id !== previousVideoTrack.id;

				if (!videoEl.srcObject || videoTrackChanged) {
					videoEl.srcObject = new MediaStream(videoTracks);
				}
			}
			// we have a separate audio element for audio playback
			videoEl.muted = true;
		}

		this.videoElements.set(participantId, videoEl);

		if (this.deferredAttachments.has(participantId)) {
			const deferred = this.deferredAttachments.get(
				participantId,
			) as DeferredAttachment;
			this.deferredAttachments.delete(participantId);
			if (deferred.timer) clearTimeout(deferred.timer);
			void this.attachStream(participantId, deferred.stream, deferred.isLocal).then(
				deferred.resolve,
				deferred.reject,
			);
		}
	}

	async attachStream(
		participantId: string,
		stream: MediaStream,
		isLocal = false,
	): Promise<void> {
		const videoElement = this.videoElements.get(participantId);
		const audioTracks = stream.getAudioTracks();

		// Always attach audio for remote participants, even if no video element exists
		if (!isLocal && audioTracks.length > 0) {
			await this.attachAudioStream(participantId, audioTracks);
		}

		// Only defer if we have video tracks and no video element
		// Audio-only streams don't need video elements, so don't defer them
		if (!videoElement && !isLocal && stream.getVideoTracks().length > 0) {
			if (!this.strictAttachmentTimeoutMs) {
				this.deferredAttachments.set(participantId, { stream, isLocal });
				return;
			}
			return new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.deferredAttachments.delete(participantId);
					reject(new Error(`Timed out waiting for video element for ${participantId}`));
				}, this.strictAttachmentTimeoutMs);
				this.deferredAttachments.set(participantId, { stream, isLocal, resolve, reject, timer });
			});
		}

		if (videoElement) {
			const videoTracks = stream.getVideoTracks();

			if (videoTracks.length > 0) {
				const newVideoTrack = videoTracks[0];
				const existingVideoTrack = (
					videoElement.srcObject as MediaStream | null
				)?.getVideoTracks?.()?.[0];
				const lastAttach = this.lastVideoAttachAt.get(participantId);
				const isStale =
					lastAttach !== undefined &&
					Date.now() - lastAttach > STALE_REATTACH_MS;
				const videoTrackChanged =
					!existingVideoTrack || existingVideoTrack.id !== newVideoTrack.id;

				if (!videoElement.srcObject || videoTrackChanged || isStale) {
					console.log(`Attaching video track for ${participantId}`, {
						trackId: newVideoTrack.id,
						hadExisting: !!existingVideoTrack,
						changed: videoTrackChanged,
						stale: isStale,
					});
					const videoStream = new MediaStream(videoTracks);
					videoElement.srcObject = videoStream;
					// we have a separate audio element for audio playback
					videoElement.muted = true;
					this.lastVideoAttachAt.set(participantId, Date.now());

					try {
						await videoElement.play();
					} catch (err) {
						console.error(`Error playing video for ${participantId}:`, err);
						if (this.strictAttachmentTimeoutMs) throw err;
						if ((err as DOMException).name === "NotAllowedError")
							this.addUserInteractionHandler(videoElement, participantId);
					}
				} else {
					console.log(
						`Skipping video re-attach for ${participantId} - same track`,
					);
				}
			}
		}
	}

	async attachAudioStream(
		participantId: string,
		audioTracks: MediaStreamTrack[],
	): Promise<void> {
		let audioElement = this.audioElements.get(participantId);

		if (!audioElement) {
			audioElement = document.createElement("audio");
			audioElement.autoplay = true;
			audioElement.setAttribute("playsinline", "");
			audioElement.style.display = "none";
			document.body.appendChild(audioElement);

			if (selectedSpeakerId.value) {
				(
					audioElement as HTMLAudioElement & {
						setSinkId?: (id: string) => Promise<void>;
					}
				)
					.setSinkId?.(selectedSpeakerId.value)
					.catch((err: Error) => {
						console.warn(
							`Failed to set initial speaker for ${participantId}:`,
							err,
						);
					});
			}

			this.audioElements.set(participantId, audioElement);
			console.log(`Created separate audio element for ${participantId}`);
		}

		const newAudioTrack = audioTracks[0];
		const existingAudioTrack = (
			audioElement.srcObject as MediaStream | null
		)?.getAudioTracks?.()?.[0];
		const lastAttach = this.lastAudioAttachAt.get(participantId);
		const isStale =
			lastAttach !== undefined && Date.now() - lastAttach > STALE_REATTACH_MS;
		const audioTrackChanged =
			!existingAudioTrack || existingAudioTrack.id !== newAudioTrack.id;

		if (!audioElement.srcObject || audioTrackChanged || isStale) {
			const audioStream = new MediaStream(audioTracks);
			audioElement.srcObject = audioStream;
			this.lastAudioAttachAt.set(participantId, Date.now());

			// Try to play audio
			try {
				await audioElement.play();
			} catch (err) {
				console.warn(
					`Audio autoplay failed for ${participantId}:`,
					(err as Error).message,
				);
				if (this.strictAttachmentTimeoutMs) throw err;
				if ((err as DOMException).name === "NotAllowedError")
					this.addUserInteractionHandler(audioElement, participantId);
			}
		}
	}

	async playVideo(
		element: HTMLVideoElement,
		participantId: string,
	): Promise<boolean> {
		try {
			await element.play();
			return true;
		} catch (error) {
			if ((error as DOMException).name === "NotAllowedError") {
				console.warn(
					`Autoplay blocked for ${participantId}, will play on user interaction`,
				);
				this.addUserInteractionHandler(element, participantId);
			} else {
				console.warn(
					`Video play failed for ${participantId}:`,
					(error as Error).message,
				);
			}
			return false;
		}
	}

	addUserInteractionHandler(
		element: HTMLMediaElement,
		participantId: string,
	): void {
		const playOnInteraction = async () => {
			try {
				await element.play();

				document.removeEventListener("click", playOnInteraction);
				document.removeEventListener("touchstart", playOnInteraction);
			} catch (error) {
				console.warn(
					`Unable to play video for ${participantId}:`,
					(error as Error).message,
				);
			}
		};

		document.addEventListener("click", playOnInteraction, { once: true });
		document.addEventListener("touchstart", playOnInteraction, { once: true });
	}

	removeVideoElement(participantId: string): void {
		const element = this.videoElements.get(participantId);
		let hadStream = false;
		if (element?.srcObject) {
			hadStream = true;
			for (const track of (element.srcObject as MediaStream).getTracks()) {
				track.stop();
			}
			element.srcObject = null;
		}

		const audioElement = this.audioElements.get(participantId);
		if (audioElement) {
			if (audioElement.srcObject) {
				for (const track of (
					audioElement.srcObject as MediaStream
				).getTracks()) {
					track.stop();
				}
				audioElement.srcObject = null;
			}
			audioElement.remove();
			this.audioElements.delete(participantId);
		}

		this.videoElements.delete(participantId);
		const deferred = this.deferredAttachments.get(participantId);
		if (deferred?.timer) clearTimeout(deferred.timer);
		this.deferredAttachments.delete(participantId);
		this.lastVideoAttachAt.delete(participantId);
		this.lastAudioAttachAt.delete(participantId);

		console.log(`Video/Audio elements removed for ${participantId}`, {
			hadStream,
			elementExists: !!element,
			hadAudioElement: !!audioElement,
		});
	}

	cleanup(): void {
		for (const deferred of this.deferredAttachments.values()) {
			if (deferred.timer) clearTimeout(deferred.timer);
			deferred.reject?.(new Error("Video element manager cleaned up"));
		}
		for (const [_participantId, element] of this.videoElements.entries()) {
			if (element?.srcObject) {
				for (const track of (element.srcObject as MediaStream).getTracks()) {
					track.stop();
				}
				element.srcObject = null;
			}
		}

		for (const [_participantId, audioElement] of this.audioElements.entries()) {
			if (audioElement?.srcObject) {
				for (const track of (
					audioElement.srcObject as MediaStream
				).getTracks()) {
					track.stop();
				}
				audioElement.srcObject = null;
			}
			audioElement.remove();
		}

		this.videoElements.clear();
		this.audioElements.clear();
		this.deferredAttachments.clear();
		this.lastVideoAttachAt.clear();
		this.lastAudioAttachAt.clear();
	}
}
