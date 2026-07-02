import type { Peer, PeerInfo, Room } from '../types';
import { loggers } from '../utils/logger';

export class PeerManager {
	private peers = new Map<string, { roomId: string; peer: Peer }>();

	addPeer(room: Room, peerId: string, peerInfo: Partial<PeerInfo> = {}): Peer {
		loggers.peerManager.info('Adding peer %s to room %s', peerId, room.id);

		if (room.peers.has(peerId)) {
			loggers.peerManager.warn(
				'Peer %s already exists in room %s, updating info',
				peerId,
				room.id,
			);
			const existingPeer = room.peers.get(peerId)!;
			existingPeer.info = { ...existingPeer.info, ...peerInfo };
			return existingPeer;
		}

		// Ensure default media state flags
		const normalizedInfo: PeerInfo = {
			name: peerInfo.name || '',
			userId: peerInfo.userId || peerId,
			avatar: peerInfo.avatar,
			audio_enabled:
				typeof peerInfo.audio_enabled === 'boolean'
					? peerInfo.audio_enabled
					: false,
			video_enabled:
				typeof peerInfo.video_enabled === 'boolean'
					? peerInfo.video_enabled
					: false,
			is_guest:
				typeof peerInfo.is_guest === 'boolean' ? peerInfo.is_guest : false,
			senderId: peerInfo.senderId,
			isHost: peerInfo.isHost || false,
		};

		const peer: Peer = {
			id: peerId,
			info: normalizedInfo,
			transports: new Map(),
			producers: new Map(),
			consumers: new Map(),
			joined: new Date(),
		};

		room.peers.set(peerId, peer);
		this.peers.set(peerId, { roomId: room.id, peer });

		loggers.peerManager.info('Peer added: %s', peerId);
		loggers.peerManager.info(
			'Room %s now has %d peers',
			room.id,
			room.peers.size,
		);
		return peer;
	}

	removePeer(room: Room, peerId: string): void {
		const peer = room.peers.get(peerId);
		if (!peer) return;

		loggers.peerManager.info('Removing peer %s from room %s', peerId, room.id);

		// Close all transports
		for (const transport of peer.transports.values()) {
			try {
				transport.close();
			} catch (error) {
				loggers.peerManager.warn(
					'Error closing transport: %s',
					(error as Error).message,
				);
			}
		}

		for (const producer of peer.producers.values()) {
			try {
				producer.close();
			} catch (error) {
				loggers.peerManager.warn(
					'Error closing producer: %s',
					(error as Error).message,
				);
			}
		}

		for (const consumer of peer.consumers.values()) {
			try {
				consumer.close();
			} catch (error) {
				loggers.peerManager.warn(
					'Error closing consumer: %s',
					(error as Error).message,
				);
			}
		}

		room.peers.delete(peerId);
		this.peers.delete(peerId);

		loggers.peerManager.info('Peer removed: %s', peerId);
	}

	getPeer(peerId: string): Peer | undefined {
		const peerData = this.peers.get(peerId);
		return peerData?.peer;
	}

	getPeerRoom(peerId: string): string | undefined {
		return this.peers.get(peerId)?.roomId;
	}

	getPeerCount(): number {
		return this.peers.size;
	}

	updatePeerInfo(room: Room, peerId: string, updates: Partial<PeerInfo>): void {
		const peer = room.peers.get(peerId);
		if (peer) {
			peer.info = { ...peer.info, ...updates };
		}
	}

	cleanup(): void {
		this.peers.clear();
	}
}
