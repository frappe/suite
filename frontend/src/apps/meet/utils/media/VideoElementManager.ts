/** Owns MediaStream attachment and playback recovery for Meet media elements. */
import { selectedSpeakerId } from "../../data/mediaPreferences";

export type MediaAttachmentRole =
	| "remote-video"
	| "remote-audio"
	| "local-preview"
	| "screen-share"
	| "background-effects";
export type AttachmentTrackOwnership = "owned" | "borrowed";

export interface MediaAttachmentFacade {
	registerRemoteVideoElement: (
		participantId: string,
		element: HTMLVideoElement | null,
	) => void;
	registerLocalPreview: (element: HTMLVideoElement | null) => void;
	attachLocalPreview: (stream: MediaStream | null) => Promise<void>;
	registerScreenSharePreview: (
		attachmentId: string,
		element: HTMLVideoElement | null,
	) => void;
	attachScreenSharePreview: (
		attachmentId: string,
		stream: MediaStream,
		trackOwnership?: AttachmentTrackOwnership,
	) => Promise<void>;
	removeScreenSharePreview: (attachmentId: string) => void;
	attachBackgroundEffectsSource: (
		attachmentId: string,
		element: HTMLVideoElement,
		stream: MediaStream,
	) => Promise<void>;
	removeBackgroundEffectsSource: (attachmentId: string) => void;
	setAudioOutputDevice: (deviceId: string) => Promise<void>;
}

interface DeferredAttachment {
	stream: MediaStream;
	isLocal: boolean;
	resolve?: () => void;
	reject?: (error: unknown) => void;
	timer?: ReturnType<typeof setTimeout>;
}

interface Attachment {
	role: MediaAttachmentRole;
	id: string;
	element: HTMLMediaElement | null;
	stream: MediaStream | null;
	ownsTracks: boolean;
	createdElement: boolean;
	lastAttachAt?: number;
	attachedStreamId?: string;
	attachedTrackIds?: string;
	revision: number;
}

const STALE_REATTACH_MS = 60_000;
const LOCAL_PREVIEW_ID = "local";

const attachmentKey = (role: MediaAttachmentRole, id: string) => `${role}:${id}`;

export class VideoElementManager implements MediaAttachmentFacade {
	/** Kept public for recorder compatibility and diagnostics. */
	videoElements = new Map<string, HTMLVideoElement>();
	/** Kept public for existing diagnostics. Sink routing belongs to this manager. */
	audioElements = new Map<string, HTMLAudioElement>();
	deferredAttachments = new Map<string, DeferredAttachment>();

	private attachments = new Map<string, Attachment>();
	private playbackHandlers = new Map<HTMLMediaElement, () => void>();
	private speakerId = selectedSpeakerId.value;

	constructor(private strictAttachmentTimeoutMs?: number) {}

	registerRemoteVideoElement(
		participantId: string,
		element: HTMLVideoElement | null,
	): void {
		if (!participantId) return;
		const deferred = this.deferredAttachments.get(participantId);
		this.registerElement(
			"remote-video",
			participantId,
			element,
			true,
			false,
			!deferred,
		);
		if (element) this.videoElements.set(participantId, element);
		else this.videoElements.delete(participantId);

		if (!element || !deferred) return;
		this.deferredAttachments.delete(participantId);
		if (deferred.timer) clearTimeout(deferred.timer);
		void this.attachStream(participantId, deferred.stream, deferred.isLocal).then(
			deferred.resolve,
			deferred.reject,
		);
	}

	/** Legacy remote-video facade used by the recorder and existing tile callers. */
	registerVideoElement(participantId: string, element: HTMLElement): void {
		this.registerRemoteVideoElement(participantId, element as HTMLVideoElement);
	}

	registerLocalPreview(element: HTMLVideoElement | null): void {
		this.registerElement("local-preview", LOCAL_PREVIEW_ID, element, false);
	}

	attachLocalPreview(stream: MediaStream | null): Promise<void> {
		if (!stream) {
			this.clearAttachmentStream("local-preview", LOCAL_PREVIEW_ID, false);
			return Promise.resolve();
		}
		return this.attach("local-preview", LOCAL_PREVIEW_ID, stream, false);
	}

	registerScreenSharePreview(
		attachmentId: string,
		element: HTMLVideoElement | null,
	): void {
		if (!attachmentId) return;
		this.registerElement("screen-share", attachmentId, element, false);
	}

	attachScreenSharePreview(
		attachmentId: string,
		stream: MediaStream,
		trackOwnership: AttachmentTrackOwnership = "borrowed",
	): Promise<void> {
		return this.attach(
			"screen-share",
			attachmentId,
			stream,
			trackOwnership === "owned",
		);
	}

	removeScreenSharePreview(attachmentId: string): void {
		this.removeAttachment("screen-share", attachmentId);
	}

	attachBackgroundEffectsSource(
		attachmentId: string,
		element: HTMLVideoElement,
		stream: MediaStream,
	): Promise<void> {
		this.registerElement("background-effects", attachmentId, element, false);
		return this.attach("background-effects", attachmentId, stream, false);
	}

	removeBackgroundEffectsSource(attachmentId: string): void {
		this.removeAttachment("background-effects", attachmentId);
	}

	async attachStream(
		participantId: string,
		stream: MediaStream,
		isLocal = false,
	): Promise<void> {
		if (isLocal) return this.attachLocalPreview(stream);

		const audioTracks = stream.getAudioTracks();
		if (audioTracks.length) await this.attachAudioStream(participantId, audioTracks);

		if (!stream.getVideoTracks().length) return;
		const video = this.getAttachment("remote-video", participantId)?.element;
		if (!video) {
			this.rememberStream("remote-video", participantId, stream, true);
			if (!this.strictAttachmentTimeoutMs) {
				this.deferredAttachments.set(participantId, { stream, isLocal });
				return;
			}
			this.cancelDeferredAttachment(participantId);
			return new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					if (this.deferredAttachments.get(participantId)?.timer === timer) {
						this.deferredAttachments.delete(participantId);
					}
					reject(new Error(`Timed out waiting for video element for ${participantId}`));
				}, this.strictAttachmentTimeoutMs);
				this.deferredAttachments.set(participantId, {
					stream,
					isLocal,
					resolve,
					reject,
					timer,
				});
			});
		}
		await this.attach("remote-video", participantId, stream, true);
	}

	async attachAudioStream(
		participantId: string,
		audioTracks: MediaStreamTrack[],
	): Promise<void> {
		if (!audioTracks.length) return;
		let audio = this.audioElements.get(participantId);
		if (!audio) {
			audio = document.createElement("audio");
			audio.style.display = "none";
			document.body.appendChild(audio);
			this.audioElements.set(participantId, audio);
			this.registerElement("remote-audio", participantId, audio, true, true);
			await this.applySink(audio, participantId);
		}
		await this.attach(
			"remote-audio",
			participantId,
			new MediaStream(audioTracks),
			true,
		);
	}

	async setAudioOutputDevice(deviceId: string): Promise<void> {
		this.speakerId = deviceId;
		await Promise.all(
			Array.from(this.audioElements, ([participantId, element]) =>
				this.applySink(element, participantId),
			),
		);
	}

	async playVideo(
		element: HTMLVideoElement,
		participantId: string,
	): Promise<boolean> {
		return this.playElement(element, participantId);
	}

	/** Retries every registered role after browser lifecycle resume. */
	async retryPlayback(): Promise<void> {
		const registered = new Map<HTMLMediaElement, string>();
		for (const attachment of this.attachments.values()) {
			if (attachment.element) {
				registered.set(
					attachment.element,
					`${attachment.role}:${attachment.id}`,
				);
			}
		}
		for (const [participantId, element] of this.videoElements) {
			registered.set(element, `remote-video:${participantId}`);
		}
		for (const [participantId, element] of this.audioElements) {
			registered.set(element, `remote-audio:${participantId}`);
		}
		await Promise.all(
			Array.from(registered, ([element, id]) => {
				return element?.srcObject
					? this.playElement(element, id)
					: Promise.resolve(false);
			}),
		);
	}

	addUserInteractionHandler(
		element: HTMLMediaElement,
		attachmentId: string,
	): void {
		if (this.playbackHandlers.has(element)) return;
		const playOnInteraction = async () => {
			try {
				await element.play();
				this.clearPlaybackHandler(element);
			} catch (error) {
				console.warn(
					`Unable to play media for ${attachmentId}:`,
					(error as Error).message,
				);
			}
		};
		this.playbackHandlers.set(element, playOnInteraction);
		document.addEventListener("click", playOnInteraction);
		document.addEventListener("touchstart", playOnInteraction);
	}

	removeVideoElement(participantId: string): void {
		this.removeAttachment("remote-video", participantId);
		this.removeAttachment("remote-audio", participantId);
		this.videoElements.delete(participantId);
		this.audioElements.delete(participantId);
		this.cancelDeferredAttachment(participantId);
	}

	cancelDeferredAttachment(participantId: string): void {
		const deferred = this.deferredAttachments.get(participantId);
		if (!deferred) return;
		if (deferred.timer) clearTimeout(deferred.timer);
		this.deferredAttachments.delete(participantId);
		deferred.resolve?.();
	}

	cleanupRemoteMedia(): void {
		for (const attachment of [...this.attachments.values()]) {
			if (
				attachment.role === "remote-video" ||
				attachment.role === "remote-audio" ||
				(attachment.role === "screen-share" && attachment.ownsTracks)
			) {
				this.removeAttachment(attachment.role, attachment.id);
			}
		}
		this.videoElements.clear();
		this.audioElements.clear();
		for (const deferred of this.deferredAttachments.values()) {
			if (deferred.timer) clearTimeout(deferred.timer);
			deferred.reject?.(new Error("Video element manager cleaned up"));
		}
		this.deferredAttachments.clear();
	}

	cleanup(): void {
		for (const attachment of [...this.attachments.values()]) {
			this.removeAttachment(attachment.role, attachment.id);
		}
		for (const element of [...this.playbackHandlers.keys()]) {
			this.clearPlaybackHandler(element);
		}
		for (const deferred of this.deferredAttachments.values()) {
			if (deferred.timer) clearTimeout(deferred.timer);
			deferred.reject?.(new Error("Video element manager cleaned up"));
		}
		this.videoElements.clear();
		this.audioElements.clear();
		this.deferredAttachments.clear();
	}

	private registerElement(
		role: MediaAttachmentRole,
		id: string,
		element: HTMLMediaElement | null,
		ownsTracks: boolean,
		createdElement = false,
		attachStoredStream = true,
	): void {
		const attachment = this.getOrCreateAttachment(role, id, ownsTracks);
		const previous = attachment.element;
		if (previous !== element) attachment.revision++;
		if (previous && previous !== element) this.detachElement(previous, false);
		attachment.element = element;
		attachment.createdElement = createdElement;
		if (!element) return;
		this.configureElement(element, role);
		if (attachment.stream && attachStoredStream) {
			void this.attachCurrentStream(attachment).catch((error) =>
				console.warn(`Failed to restore ${role}:${id} playback:`, error),
			);
		}
	}

	private rememberStream(
		role: MediaAttachmentRole,
		id: string,
		stream: MediaStream,
		ownsTracks: boolean,
	): Attachment {
		const attachment = this.getOrCreateAttachment(role, id, ownsTracks);
		if (
			attachment.stream &&
			attachment.stream !== stream &&
			attachment.ownsTracks
		) {
			this.stopReplacedTracks(attachment.stream, stream);
		}
		attachment.stream = stream;
		attachment.ownsTracks = ownsTracks;
		return attachment;
	}

	private async attach(
		role: MediaAttachmentRole,
		id: string,
		stream: MediaStream,
		ownsTracks: boolean,
	): Promise<void> {
		const attachment = this.rememberStream(role, id, stream, ownsTracks);
		if (attachment.element) await this.attachCurrentStream(attachment);
	}

	private async attachCurrentStream(attachment: Attachment): Promise<void> {
		const { element, role, stream } = attachment;
		if (!element || !stream) return;
		const tracks =
			role === "remote-audio" ? stream.getAudioTracks() : stream.getVideoTracks();
		if (!tracks.length) return;
		const trackIds = tracks.map((track) => track.id).join(",");
		const currentTracks = (element.srcObject as MediaStream | null)
			?.getTracks()
			.map((track) => track.id)
			.join(",");
		const stale =
			attachment.lastAttachAt !== undefined &&
			Date.now() - attachment.lastAttachAt > STALE_REATTACH_MS;
		const sourceStreamChanged =
			role !== "remote-video" &&
			role !== "remote-audio" &&
			attachment.attachedStreamId !== stream.id;
		const changed =
			!element.srcObject ||
			sourceStreamChanged ||
			attachment.attachedTrackIds !== trackIds ||
			currentTracks !== trackIds;
		if (!changed && !stale) return;

		this.configureElement(element, role);
		this.clearPlaybackHandler(element);
		element.srcObject = new MediaStream(tracks);
		attachment.attachedStreamId = stream.id;
		attachment.attachedTrackIds = trackIds;
		attachment.lastAttachAt = Date.now();
		const revision = ++attachment.revision;
		const played = await this.playElement(
			element,
			`${role}:${attachment.id}`,
			() =>
				this.getAttachment(role, attachment.id) === attachment &&
				attachment.element === element &&
				attachment.revision === revision,
		);
		if (!played && this.strictAttachmentTimeoutMs) {
			throw new Error(`Media playback failed for ${attachment.id}`);
		}
	}

	private configureElement(
		element: HTMLMediaElement,
		role: MediaAttachmentRole,
	): void {
		element.autoplay = true;
		element.setAttribute("playsinline", "");
		if (element instanceof HTMLVideoElement) {
			element.playsInline = true;
			element.muted = true;
		}
		if (role === "remote-audio") element.muted = false;
	}

	private async playElement(
		element: HTMLMediaElement,
		attachmentId: string,
		isCurrent: () => boolean = () => true,
	): Promise<boolean> {
		try {
			await element.play();
			if (!isCurrent()) return true;
			this.clearPlaybackHandler(element);
			return true;
		} catch (error) {
			if (!isCurrent()) return true;
			if ((error as DOMException).name === "NotAllowedError") {
				if (!this.strictAttachmentTimeoutMs) {
					this.addUserInteractionHandler(element, attachmentId);
				}
			} else {
				console.warn(
					`Media play failed for ${attachmentId}:`,
					(error as Error).message,
				);
			}
			if (this.strictAttachmentTimeoutMs) throw error;
			return false;
		}
	}

	private async applySink(
		element: HTMLAudioElement,
		participantId: string,
	): Promise<void> {
		if (!this.speakerId || typeof element.setSinkId !== "function") return;
		try {
			await element.setSinkId(this.speakerId);
		} catch (error) {
			console.warn(`Failed to set speaker for ${participantId}:`, error);
		}
	}

	private clearPlaybackHandler(element: HTMLMediaElement): void {
		const handler = this.playbackHandlers.get(element);
		if (!handler) return;
		document.removeEventListener("click", handler);
		document.removeEventListener("touchstart", handler);
		this.playbackHandlers.delete(element);
	}

	private clearAttachmentStream(
		role: MediaAttachmentRole,
		id: string,
		stopOwnedTracks: boolean,
	): void {
		const attachment = this.getAttachment(role, id);
		if (!attachment) return;
		if (stopOwnedTracks && attachment.ownsTracks) this.stopTracks(attachment.stream);
		attachment.stream = null;
		attachment.attachedStreamId = undefined;
		attachment.attachedTrackIds = undefined;
		attachment.lastAttachAt = undefined;
		if (attachment.element) this.detachElement(attachment.element, false);
	}

	private removeAttachment(role: MediaAttachmentRole, id: string): void {
		const key = attachmentKey(role, id);
		const attachment = this.attachments.get(key);
		if (!attachment) return;
		if (attachment.ownsTracks) this.stopTracks(attachment.stream);
		if (attachment.element) {
			const element = attachment.element;
			this.detachElement(element, attachment.createdElement);
		}
		this.attachments.delete(key);
	}

	private detachElement(element: HTMLMediaElement, remove: boolean): void {
		this.clearPlaybackHandler(element);
		element.srcObject = null;
		if (remove) element.remove();
	}

	private stopTracks(stream: MediaStream | null): void {
		for (const track of stream?.getTracks() ?? []) track.stop();
	}

	private stopReplacedTracks(previous: MediaStream, replacement: MediaStream): void {
		const replacementTracks = replacement.getTracks();
		for (const track of previous.getTracks()) {
			const retained = replacementTracks.some(
				(candidate) =>
					candidate === track ||
					(!!track.id && candidate.kind === track.kind && candidate.id === track.id),
			);
			if (!retained) track.stop();
		}
	}

	private getAttachment(
		role: MediaAttachmentRole,
		id: string,
	): Attachment | undefined {
		return this.attachments.get(attachmentKey(role, id));
	}

	private getOrCreateAttachment(
		role: MediaAttachmentRole,
		id: string,
		ownsTracks: boolean,
	): Attachment {
		const key = attachmentKey(role, id);
		let attachment = this.attachments.get(key);
		if (!attachment) {
			attachment = {
				role,
				id,
				element: null,
				stream: null,
				ownsTracks,
				createdElement: false,
				revision: 0,
			};
			this.attachments.set(key, attachment);
		}
		return attachment;
	}
}
