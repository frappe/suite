import type { Socket } from 'socket.io';
import type { ActivePoll } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerPollHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('poll:create', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const { question, options } = data;

				if (!socket.isHost && !socket.isCohost) {
					if (callback)
						callback({ success: false, error: 'Only hosts can create polls' });
					return;
				}

				if (!roomId || !question || !options || !socket.participantId) {
					if (callback)
						callback({ success: false, error: 'Invalid poll data' });
					return;
				}

				if (
					!Array.isArray(options) ||
					options.length < 2 ||
					options.length > 10
				) {
					if (callback)
						callback({
							success: false,
							error: 'Poll must have between 2 and 10 options',
						});
					return;
				}

				if (
					options.some(
						(opt) => typeof opt?.text !== 'string' || !opt.text.trim(),
					)
				) {
					if (callback) {
						callback({
							success: false,
							error: 'Poll options cannot be empty.',
						});
					}
					return;
				}

				const activePollsMap =
					deps.registry.getActivePolls(roomId) || new Map<string, ActivePoll>();

				const pollId = `poll-${crypto.randomUUID()}`;

				const newPoll: ActivePoll = {
					pollId,
					createdBy: socket.participantId,
					question,
					options: options.map((opt: { id?: string; text: string }) => ({
						id: `opt-${crypto.randomUUID()}`,
						text: opt.text.trim(),
						votes: 0,
					})),
					votedUsers: new Set(),
					isActive: true,
				};

				activePollsMap.set(pollId, newPoll);
				deps.registry.setActivePolls(roomId, activePollsMap);

				const payloadFE = {
					pollId: newPoll.pollId,
					createdBy: newPoll.createdBy,
					question: newPoll.question,
					options: newPoll.options,
					isActive: newPoll.isActive,
				};

				if (callback) callback({ success: true, poll: payloadFE });

				deps.registry.emitToFullAccessParticipants(
					roomId,
					'poll:new',
					payloadFE,
				);
			} catch (error) {
				loggers.socketHandler.warn(
					'poll:create failed: %s',
					(error as Error).message,
				);
				if (callback)
					callback({ success: false, error: 'Internal Server Error' });
			}
		});

		socket.on('poll:vote', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const { pollId, optionId } = data;

				if (!roomId || !pollId || !optionId || !socket.participantId) {
					if (callback)
						callback({ success: false, error: 'Invalid vote data' });
					return;
				}

				const roomPolls = deps.registry.getActivePolls(roomId);
				if (!roomPolls) throw new Error('No polls in this room');

				const poll = roomPolls.get(pollId);
				if (!poll) throw new Error('Poll not found');
				if (!poll.isActive) throw new Error('Poll is closed');

				if (poll.votedUsers.has(socket.participantId)) {
					throw new Error('You have already voted');
				}

				const option = poll.options.find((opt) => opt.id === optionId);
				if (!option) throw new Error('Invalid option');

				option.votes += 1;
				poll.votedUsers.add(socket.participantId);

				const payloadFE = {
					pollId: poll.pollId,
					createdBy: poll.createdBy,
					question: poll.question,
					options: poll.options,
					isActive: poll.isActive,
				};

				if (callback) callback({ success: true });

				deps.registry.emitToFullAccessParticipants(
					roomId,
					'poll:update',
					payloadFE,
				);
			} catch (error) {
				loggers.socketHandler.warn(
					'poll:vote failed: %s',
					(error as Error).message,
				);
				if (callback)
					callback({ success: false, error: (error as Error).message });
			}
		});
	};
}
