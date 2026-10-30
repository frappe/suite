import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { setTimeout as delay } from "node:timers/promises";
import { createRelay } from "./relay.mjs";

test("real UDP delivery stops at 100% loss and resumes after restoration", async () => {
	const target = dgram.createSocket("udp4"),
		client = dgram.createSocket("udp4");
	await new Promise((resolve) => target.bind(0, "127.0.0.2", resolve));
	const port = target.address().port;
	const relay = await createRelay({ port });
	const received = [];
	target.on("message", (packet, remote) =>
		target.send(packet, remote.port, remote.address),
	);
	client.on("message", (packet) => received.push(packet.toString()));
	const send = (text) => client.send(Buffer.from(text), port, "127.0.0.1");
	try {
		send("baseline");
		await delay(100);
		assert.deepEqual(received, ["baseline"]);
		relay.setProfile({ loss: 100 });
		send("dropped");
		await delay(100);
		assert.deepEqual(received, ["baseline"]);
		assert.equal(relay.snapshot().counters.up.dropped, 1);
		relay.setProfile({ delayMs: 80 });
		send("delayed");
		await delay(40);
		assert.deepEqual(received, ["baseline"]);
		await delay(200);
		assert.deepEqual(received, ["baseline", "delayed"]);
		relay.setProfile({});
		send("recovered");
		await delay(100);
		assert.deepEqual(received, ["baseline", "delayed", "recovered"]);
	} finally {
		client.close();
		target.close();
		await relay.close();
	}
});

test("healthy publisher flow bypasses impairment while receiver flow is dropped", async () => {
	const target = dgram.createSocket("udp4");
	const publisher = dgram.createSocket("udp4");
	const receiver = dgram.createSocket("udp4");
	await new Promise((resolve) => target.bind(0, "127.0.0.2", resolve));
	const port = target.address().port;
	const relay = await createRelay({ port, bypassPeers: 1 });
	const delivered = [];
	target.on("message", (packet) => delivered.push(packet.toString()));
	try {
		publisher.send(Buffer.from("publisher-first"), port, "127.0.0.1");
		await delay(100);
		relay.setProfile({ loss: 100 });
		publisher.send(Buffer.from("publisher-still-healthy"), port, "127.0.0.1");
		receiver.send(Buffer.from("receiver-dropped"), port, "127.0.0.1");
		await delay(100);
		assert.deepEqual(delivered, ["publisher-first", "publisher-still-healthy"]);
		assert.equal(relay.snapshot().counters.up.dropped, 1);
	} finally {
		publisher.close();
		receiver.close();
		target.close();
		await relay.close();
	}
});

test("overflow drops do not reserve bandwidth or starve later packets", async () => {
	const target = dgram.createSocket("udp4");
	const client = dgram.createSocket("udp4");
	await new Promise((resolve) => target.bind(0, "127.0.0.2", resolve));
	const port = target.address().port;
	const relay = await createRelay({ port });
	const delivered = [];
	target.on("message", (packet) => delivered.push(packet.toString()));
	try {
		relay.setProfile({ upBps: 10000, maxQueueMs: 100 });
		for (let i = 0; i < 100; i++)
			client.send(Buffer.alloc(100), port, "127.0.0.1");
		await delay(300);
		client.send(Buffer.from("audio-after-burst"), port, "127.0.0.1");
		await delay(100);
		assert(
			relay.snapshot().counters.up.dropped > 0,
			"burst should overflow the bounded queue",
		);
		assert(
			delivered.includes("audio-after-burst"),
			"queue must drain after overflow without resetting the network profile",
		);
	} finally {
		client.close();
		target.close();
		await relay.close();
	}
});

test("propagation delay does not consume bounded queue capacity", async () => {
	const target = dgram.createSocket("udp4");
	const client = dgram.createSocket("udp4");
	await new Promise((resolve) => target.bind(0, "127.0.0.2", resolve));
	const port = target.address().port;
	const relay = await createRelay({ port });
	const received = [];
	target.on("message", (packet) => received.push(packet.toString()));
	try {
		relay.setProfile({ delayMs: 150, maxQueueMs: 50 });
		client.send(Buffer.from("delayed-not-congested"), port, "127.0.0.1");
		await delay(250);
		assert.deepEqual(received, ["delayed-not-congested"]);
	} finally {
		client.close();
		target.close();
		await relay.close();
	}
});
