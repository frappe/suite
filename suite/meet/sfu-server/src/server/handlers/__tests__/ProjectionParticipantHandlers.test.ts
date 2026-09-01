import { describe, expect, it, vi } from 'vitest';
import { registerChatHandlers } from '../ChatHandlers';
import { registerHostControlHandlers } from '../HostControlHandlers';
import { registerMediaControlHandlers } from '../MediaControlHandlers';
import { registerProducerHandlers } from '../ProducerHandlers';
import { registerRaiseHandHandlers } from '../RaiseHandHandlers';
import { registerReactionHandlers } from '../ReactionHandlers';

type Handler = (data: never, callback?: (response: unknown) => void) => unknown;

function setup(isOwner: boolean) {
	const handlers = new Map<string, Handler>();
	const socket = {
		id: 'socket-1',
		roomId: 'room-1',
		participantId: 'participant-1',
		peerId: 'peer-1',
		userId: 'participant-1',
		userName: 'Alice',
		isHost: true,
		isCohost: false,
		on: vi.fn((event: string, handler: Handler) =>
			handlers.set(event, handler),
		),
		emit: vi.fn(),
	};
	const registry = {
		isParticipantOwner: vi.fn(() => isOwner),
		emitProducerCreated: vi.fn(),
		emitProducerPaused: vi.fn(),
		emitMediaControlUpdate: vi.fn(),
		emitRaisedHand: vi.fn(),
		emitReaction: vi.fn(),
		emitPublicChat: vi.fn(),
		emitParticipantEvent: vi.fn(),
		recordChatMessage: vi.fn(),
		setRaisedHand: vi.fn(),
		clearRaisedHand: vi.fn(),
		hasRaisedHand: vi.fn(() => false),
		isHostOnlyChat: vi.fn(() => false),
		releaseParticipant: vi.fn(() => false),
	};
	const mediasoup = {
		createProducer: vi.fn(async () => ({
			id: 'producer-1',
			kind: 'video',
			appData: {},
		})),
		assertProducerAccess: vi.fn(),
		closeProducer: vi.fn(),
		pauseProducer: vi.fn(async () => true),
		resumeProducer: vi.fn(async () => true),
		applyMediaControl: vi.fn(),
		participantExistsInRoom: vi.fn(() => true),
	};
	const deps = {
		registry,
		mediasoup,
		authManager: { ensureFullAccess: vi.fn() },
		telemetry: { recordMediaOperation: vi.fn() },
		io: { sockets: { adapter: { rooms: new Map() }, sockets: new Map() } },
		roomLifecycle: { scheduleCleanupIfHumanEmpty: vi.fn() },
		e2eeEpochRelay: {
			getCurrentEpochNumber: vi.fn(() => 0),
			requestCommitForRemoval: vi.fn(),
		},
	};
	registerProducerHandlers(deps as never)(socket as never);
	registerMediaControlHandlers(deps as never)(socket as never);
	registerRaiseHandHandlers(deps as never)(socket as never);
	registerReactionHandlers(deps as never)(socket as never);
	registerChatHandlers(deps as never)(socket as never);
	registerHostControlHandlers(deps as never)(socket as never);
	return { handlers, mediasoup, registry };
}

describe('projection-producing participant handlers', () => {
	it('rejects every event from a participant whose ownership was released before disconnect', async () => {
		const { handlers, mediasoup, registry } = setup(false);
		const callback = vi.fn();

		await handlers.get('create_producer')?.(
			{
				kind: 'video',
				appData: {},
				rtpParameters: {},
				transportId: 'tx',
			} as never,
			callback,
		);
		await handlers.get('close_producer')?.(
			{ producerId: 'producer-1' } as never,
			callback,
		);
		await handlers.get('pause_producer')?.(
			{ producerId: 'producer-1' } as never,
			callback,
		);
		await handlers.get('resume_producer')?.(
			{ producerId: 'producer-1' } as never,
			callback,
		);
		await handlers.get('media_control')?.({ action: 'mute' } as never);
		handlers.get('raise_hand')?.({ raised: true } as never, callback);
		handlers.get('reaction:send')?.({ reaction: 'wave' } as never);
		handlers.get('chat:send')?.({ message: 'hello' } as never, callback);
		await handlers.get('host_control')?.(
			{ action: 'lower_hand', targetParticipantId: 'participant-2' } as never,
			callback,
		);

		expect(mediasoup.createProducer).not.toHaveBeenCalled();
		expect(mediasoup.closeProducer).not.toHaveBeenCalled();
		expect(mediasoup.pauseProducer).not.toHaveBeenCalled();
		expect(mediasoup.resumeProducer).not.toHaveBeenCalled();
		expect(mediasoup.applyMediaControl).not.toHaveBeenCalled();
		expect(registry.recordChatMessage).not.toHaveBeenCalled();
		expect(registry.setRaisedHand).not.toHaveBeenCalled();
		expect(registry.emitProducerCreated).not.toHaveBeenCalled();
		expect(registry.emitProducerPaused).not.toHaveBeenCalled();
		expect(registry.emitMediaControlUpdate).not.toHaveBeenCalled();
		expect(registry.emitRaisedHand).not.toHaveBeenCalled();
		expect(registry.emitReaction).not.toHaveBeenCalled();
		expect(registry.emitPublicChat).not.toHaveBeenCalled();
		expect(registry.emitParticipantEvent).not.toHaveBeenCalled();
	});

	it('projects successful pause and resume changes for the current owner', async () => {
		const { handlers, registry } = setup(true);

		await handlers.get('pause_producer')?.(
			{ producerId: 'producer-1' } as never,
			vi.fn(),
		);
		await handlers.get('resume_producer')?.(
			{ producerId: 'producer-1' } as never,
			vi.fn(),
		);

		expect(registry.emitProducerPaused.mock.calls).toEqual([
			[
				'room-1',
				{
					participantId: 'participant-1',
					producerId: 'producer-1',
					paused: true,
				},
			],
			[
				'room-1',
				{
					participantId: 'participant-1',
					producerId: 'producer-1',
					paused: false,
				},
			],
		]);
	});

	it('rechecks ownership after an awaited producer mutation', async () => {
		const { handlers, registry } = setup(true);
		registry.isParticipantOwner
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false);

		await handlers.get('pause_producer')?.(
			{ producerId: 'producer-1' } as never,
			vi.fn(),
		);

		expect(registry.emitProducerPaused).not.toHaveBeenCalled();
	});

	it.each([
		['audio', false, 'mute'],
		['audio', true, 'unmute'],
		['video', false, 'video_off'],
		['video', true, 'video_on'],
	] as const)('normalizes legacy %s media state before projection', async (type, enabled, action) => {
		const { handlers, mediasoup, registry } = setup(true);

		await handlers.get('media_control')?.({
			action: { type, enabled },
		} as never);

		expect(mediasoup.applyMediaControl).toHaveBeenCalledWith(
			'room-1',
			'participant-1',
			action,
		);
		expect(registry.emitMediaControlUpdate).toHaveBeenCalledWith(
			'room-1',
			expect.objectContaining({ action }),
		);
	});
});
