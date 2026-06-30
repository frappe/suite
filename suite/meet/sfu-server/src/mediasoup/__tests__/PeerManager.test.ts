import { describe, expect, it, vi } from 'vitest';
import type {
	Consumer,
	Peer,
	Producer,
	Room,
	WebRtcTransport,
} from '../../types';
import { PeerManager } from '../PeerManager';

function makeRoom(): Room {
	return {
		id: 'r1',
		router: {} as Room['router'],
		audioLevelObserver: {} as Room['audioLevelObserver'],
		peers: new Map(),
		created: new Date(),
	};
}

function makeTransport() {
	return { close: vi.fn() } as unknown as WebRtcTransport;
}

function makeProducer() {
	return { close: vi.fn() } as unknown as Producer;
}

function makeConsumer() {
	return { close: vi.fn() } as unknown as Consumer;
}

describe('PeerManager', () => {
	describe('addPeer', () => {
		it('creates a peer with sensible defaults when peerInfo is empty', () => {
			const mgr = new PeerManager();
			const room = makeRoom();

			const peer = mgr.addPeer(room, 'p1');

			expect(peer.id).toBe('p1');
			expect(peer.info).toEqual({
				name: '',
				userId: 'p1',
				avatar: undefined,
				audio_enabled: false,
				video_enabled: false,
				is_guest: false,
			});
			expect(peer.transports.size).toBe(0);
			expect(peer.producers.size).toBe(0);
			expect(peer.consumers.size).toBe(0);
			expect(room.peers.get('p1')).toBe(peer);
			expect(mgr.getPeer('p1')).toBe(peer);
			expect(mgr.getPeerRoom('p1')).toBe('r1');
		});

		it('honours explicit booleans for media flags and is_guest', () => {
			const mgr = new PeerManager();
			const room = makeRoom();

			const peer = mgr.addPeer(room, 'p1', {
				name: 'Alice',
				userId: 'u-1',
				avatar: 'a.png',
				audio_enabled: true,
				video_enabled: true,
				is_guest: true,
			});

			expect(peer.info).toEqual({
				name: 'Alice',
				userId: 'u-1',
				avatar: 'a.png',
				audio_enabled: true,
				video_enabled: true,
				is_guest: true,
			});
		});

		it('updates an existing peer in place when called twice for the same id', () => {
			const mgr = new PeerManager();
			const room = makeRoom();

			const first = mgr.addPeer(room, 'p1', { name: 'Alice' });
			const second = mgr.addPeer(room, 'p1', {
				name: 'Alice 2',
				audio_enabled: true,
			});

			expect(second).toBe(first);
			expect(first.info.name).toBe('Alice 2');
			expect(first.info.audio_enabled).toBe(true);
			expect(room.peers.size).toBe(1);
			expect(mgr.getPeerCount()).toBe(1);
		});
	});

	describe('removePeer', () => {
		it('closes transports, producers, and consumers; removes the peer from both maps', () => {
			const mgr = new PeerManager();
			const room = makeRoom();

			const peer: Peer = mgr.addPeer(room, 'p1', { name: 'X' });
			const t = makeTransport();
			const p = makeProducer();
			const c = makeConsumer();
			peer.transports.set('t1', t);
			peer.producers.set('prod1', p);
			peer.consumers.set('con1', c);

			mgr.removePeer(room, 'p1');

			expect(t.close).toHaveBeenCalled();
			expect(p.close).toHaveBeenCalled();
			expect(c.close).toHaveBeenCalled();
			expect(room.peers.has('p1')).toBe(false);
			expect(mgr.getPeer('p1')).toBeUndefined();
			expect(mgr.getPeerCount()).toBe(0);
		});

		it('is a no-op when the peer does not exist', () => {
			const mgr = new PeerManager();
			const room = makeRoom();
			expect(() => mgr.removePeer(room, 'ghost')).not.toThrow();
			expect(room.peers.size).toBe(0);
		});

		it('swallows close errors so cleanup keeps going', () => {
			const mgr = new PeerManager();
			const room = makeRoom();

			const peer = mgr.addPeer(room, 'p1');
			const good = makeTransport();
			const bad = {
				close: vi.fn(() => {
					throw new Error('boom');
				}),
			} as unknown as WebRtcTransport;
			peer.transports.set('good', good);
			peer.transports.set('bad', bad);

			expect(() => mgr.removePeer(room, 'p1')).not.toThrow();
			expect(good.close).toHaveBeenCalled();
			expect(room.peers.has('p1')).toBe(false);
		});
	});

	describe('updatePeerInfo', () => {
		it('merges partial updates into existing peer info', () => {
			const mgr = new PeerManager();
			const room = makeRoom();
			mgr.addPeer(room, 'p1', { name: 'A', audio_enabled: true });

			mgr.updatePeerInfo(room, 'p1', { name: 'A2', video_enabled: true });
			expect(room.peers.get('p1')?.info).toEqual(
				expect.objectContaining({
					name: 'A2',
					audio_enabled: true,
					video_enabled: true,
				}),
			);
		});

		it('is a no-op for unknown peer', () => {
			const mgr = new PeerManager();
			const room = makeRoom();
			expect(() =>
				mgr.updatePeerInfo(room, 'ghost', { name: 'X' }),
			).not.toThrow();
		});
	});

	describe('cleanup', () => {
		it('clears all peers', () => {
			const mgr = new PeerManager();
			const room = makeRoom();
			mgr.addPeer(room, 'p1');
			mgr.addPeer(room, 'p2');
			mgr.cleanup();
			expect(mgr.getPeerCount()).toBe(0);
		});
	});
});
