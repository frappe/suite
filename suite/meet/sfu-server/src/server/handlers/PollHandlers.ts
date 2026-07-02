import { randomUUID } from 'node:crypto';
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
				const { question, createdByName, options } = data;

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

				if (typeof question !== 'string' || question.trim().length === 0) {
					if (callback)
						callback({
							success: false,
							error: 'Question must be between 1 and 500 characters.',
						});
					return;
				}

				if (question.length > 500 && !socket.e2eeRequired) {
					if (callback)
						callback({
							success: false,
							error: 'Question must be between 1 and 500 characters.',
						});
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
							error: 'Poll options must be between 1 and 200 characters.',
						});
					}
					return;
				}

				if (
					!socket.e2eeRequired &&
					options.some((opt) => opt.text.length > 200)
				) {
					if (callback) {
						callback({
							success: false,
							error: 'Poll options must be between 1 and 200 characters.',
						});
					}
					return;
				}

				const activePollsMap =
					deps.registry.getActivePolls(roomId) || new Map<string, ActivePoll>();

				const pollId = `poll-${randomUUID()}`;

				const newPoll: ActivePoll = {
					pollId,
					createdBy: socket.participantId,
					createdByName:
						typeof createdByName === 'string' && createdByName.trim()
							? createdByName.trim()
							: socket.participantId,
					question,
					options: options.map((opt: { id?: string; text: string }) => ({
						id: `opt-${randomUUID()}`,
						text: opt.text.trim(),
						votes: 0,
					})),
					votedUsers: new Set(),
					isActive: true,
					createdAt: new Date().toISOString(),
				};

				activePollsMap.set(pollId, newPoll);
				deps.registry.setActivePolls(roomId, activePollsMap);

				const payloadFE = {
					pollId: newPoll.pollId,
					createdBy: newPoll.createdBy,
					createdByName: newPoll.createdByName,
					question: newPoll.question,
					options: newPoll.options,
					isActive: newPoll.isActive,
					createdAt: newPoll.createdAt,
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
				deps.authManager.ensureNotGuest(socket);
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
					createdByName: poll.createdByName,
					question: poll.question,
					options: poll.options,
					isActive: poll.isActive,
					createdAt: poll.createdAt,
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

		socket.on('poll:sync_encrypted', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const { pollId, question, options } = data;

				if (!socket.isHost && !socket.isCohost) {
					if (callback)
						callback({ success: false, error: 'Only hosts can sync polls' });
					return;
				}

				if (!roomId || !pollId || typeof question !== 'string') {
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

				const roomPolls = deps.registry.getActivePolls(roomId);
				const poll = roomPolls?.get(pollId);
				if (!poll) throw new Error('Poll not found');

				for (const option of options) {
					const existing = poll.options.find((opt) => opt.id === option.id);
					if (
						!existing ||
						typeof option.text !== 'string' ||
						!option.text.trim()
					) {
						throw new Error('Invalid poll option');
					}
				}

				poll.question = question;
				for (const option of options) {
					const existing = poll.options.find((opt) => opt.id === option.id);
					if (existing) existing.text = option.text;
				}

				const payloadFE = {
					pollId: poll.pollId,
					createdBy: poll.createdBy,
					createdByName: poll.createdByName,
					question: poll.question,
					options: poll.options,
					isActive: poll.isActive,
					createdAt: poll.createdAt,
				};

				if (callback) callback({ success: true });
				deps.registry.emitToFullAccessParticipants(
					roomId,
					'poll:update',
					payloadFE,
				);
			} catch (error) {
				loggers.socketHandler.warn(
					'poll:sync_encrypted failed: %s',
					(error as Error).message,
				);
				if (callback)
					callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_existing_polls', (_data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				if (!roomId || !socket.participantId) {
					if (callback) callback({ success: false, error: 'Not in a room' });
					return;
				}

				const roomPolls = deps.registry.getActivePolls(roomId);
				if (!roomPolls || roomPolls.size === 0) {
					if (callback) callback({ success: true, polls: [] });
					return;
				}

				const polls = Array.from(roomPolls.values()).map((poll) => ({
					pollId: poll.pollId,
					createdBy: poll.createdBy,
					createdByName: poll.createdByName,
					question: poll.question,
					options: poll.options,
					isActive: poll.isActive,
					hasVoted: poll.votedUsers.has(socket.participantId!),
					createdAt: poll.createdAt,
				}));

				if (callback) callback({ success: true, polls });
			} catch (error) {
				loggers.socketHandler.warn(
					'get_existing_polls failed: %s',
					(error as Error).message,
				);
				if (callback)
					callback({ success: false, error: 'Internal Server Error' });
			}
		});
	};
}
