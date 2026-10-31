import dgram from "node:dgram";
import { performance } from "node:perf_hooks";

// Run-owned UDP relay: no root privileges or changes to host networking.
export async function createRelay({
	port = 44170,
	targetHost = "127.0.0.2",
	bypassPeers = 0,
} = {}) {
	const listener = dgram.createSocket("udp4");
	const peers = new Map(),
		timers = new Set();
	let profile = {},
		generation = 0,
		random = 123456789;
	let next = { up: 0, down: 0 };
	let counters;
	const reset = () =>
		(counters = {
			up: { received: 0, delivered: 0, dropped: 0, bytes: 0 },
			down: { received: 0, delivered: 0, dropped: 0, bytes: 0 },
		});
	reset();
	function forward(direction, packet, send, bypass = false) {
		if (bypass) {
			send();
			return;
		}
		const count = counters[direction];
		count.received++;
		random ^= random << 13;
		random ^= random >>> 17;
		random ^= random << 5;
		if ((random >>> 0) / 4294967296 < (profile.loss || 0) / 100) {
			count.dropped++;
			return;
		}
		const now = performance.now(),
			rate = profile[direction + "Bps"];
		const finish =
			Math.max(now, next[direction]) +
			(rate ? (packet.length * 1000) / rate : 0);
		const due = finish + (profile.delayMs || 0);
		if (finish - now > (profile.maxQueueMs ?? 1000)) {
			count.dropped++;
			return;
		}
		// A dropped packet never entered the queue and consumes no service time.
		next[direction] = finish;
		const ownGeneration = generation;
		const timer = setTimeout(
			() => {
				timers.delete(timer);
				if (generation !== ownGeneration) return;
				send();
				count.delivered++;
				count.bytes += packet.length;
			},
			Math.max(0, due - now),
		);
		timers.add(timer);
	}
	listener.on("message", (packet, remote) => {
		const key = remote.address + ":" + remote.port;
		let peer = peers.get(key);
		if (!peer) {
			peer = dgram.createSocket("udp4");
			peer.bypass = peers.size < bypassPeers;
			peers.set(key, peer);
			peer.on("error", () => {});
			peer.on("message", (reply) =>
				forward(
					"down",
					reply,
					() => listener.send(reply, remote.port, remote.address),
					peer.bypass,
				),
			);
		}
		forward(
			"up",
			packet,
			() => peer.send(packet, port, targetHost),
			peer.bypass,
		);
	});
	await new Promise((resolve, reject) => {
		listener.once("error", reject);
		listener.bind(port, "127.0.0.1", resolve);
	});
	return {
		setProfile(value) {
			generation++;
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			profile = value;
			next = { up: 0, down: 0 };
			reset();
		},
		snapshot() {
			return structuredClone({
				profile,
				counters,
				peers: peers.size,
				bypassPeers,
			});
		},
		async close() {
			for (const timer of timers) clearTimeout(timer);
			for (const peer of peers.values()) peer.close();
			await new Promise((resolve) => listener.close(resolve));
		},
	};
}
