import type { SFUClient } from "../SFUClient";
import { E2EEMeeting } from "./E2EEMeeting";

export interface E2EETransformPolicy {
	readonly transformsEnabled: boolean;
	readonly legacyInsertableStreamsEnabled: boolean;
	readonly ownSenderId: number;
	readonly hasContext: boolean;

	setSFUClient(client: SFUClient): void;
	assertContextReady(operation: string): void;
	setupSenderTransform(
		sender: RTCRtpSender,
		senderId: number,
		mediaType: string,
	): Promise<boolean>;
	preCreateReceiverStreams(receiver: RTCRtpReceiver): void;
	setupReceiverTransform(
		receiver: RTCRtpReceiver,
		senderId: number,
		mediaType: string,
	): Promise<boolean>;
}

export class DefaultE2EETransformPolicy implements E2EETransformPolicy {
	private sfuClient: SFUClient | null = null;

	constructor(sfuClient?: SFUClient) {
		if (sfuClient) {
			this.sfuClient = sfuClient;
		}
	}

	setSFUClient(client: SFUClient): void {
		this.sfuClient = client;
	}

	get transformsEnabled(): boolean {
		return (
			Boolean(this.sfuClient?.isE2EERequired?.()) &&
			E2EEMeeting.instance.hasMeetingContext()
		);
	}

	get legacyInsertableStreamsEnabled(): boolean {
		return (
			this.transformsEnabled &&
			this.sfuClient?.getE2EEMode?.() === "insertable-streams"
		);
	}

	get ownSenderId(): number {
		return this.sfuClient?.getOwnSenderId?.() ?? 0;
	}

	get hasContext(): boolean {
		return E2EEMeeting.instance.hasMeetingContext();
	}

	assertContextReady(operation: string): void {
		if (
			this.sfuClient?.isE2EERequired?.() &&
			!E2EEMeeting.instance.hasMeetingContext()
		) {
			throw new Error(
				`Cannot ${operation}: E2EE is required but meeting context is not ready`,
			);
		}
	}

	setupSenderTransform(
		sender: RTCRtpSender,
		senderId: number,
		mediaType: string,
	): Promise<boolean> {
		return E2EEMeeting.instance.setupSenderTransform(
			sender,
			senderId,
			mediaType,
		);
	}

	preCreateReceiverStreams(receiver: RTCRtpReceiver): void {
		E2EEMeeting.instance.preCreateReceiverStreams(receiver);
	}

	setupReceiverTransform(
		receiver: RTCRtpReceiver,
		senderId: number,
		mediaType: string,
	): Promise<boolean> {
		return E2EEMeeting.instance.setupReceiverTransform(
			receiver,
			senderId,
			mediaType,
		);
	}
}
