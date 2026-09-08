import assert from "node:assert/strict";
import test from "node:test";
import { boundedInteger, cameraDeliveryReady, containsJwt, delta, evaluateCameras, evaluateRotation, finiteDelta, parseResourceMetrics, percentile, rotationWindows, targetMetadata } from "./report.mjs";

test("target safety defaults to loopback and rejects shared or remote targets", () => {
	assert.deepEqual(targetMetadata("http://127.0.0.1:4317/", false), {
		endpoint: "http://127.0.0.1:4317",
		loopback: true,
	});
	assert.throws(() => targetMetadata("http://127.0.0.1:3000", false), /shared SFU/);
	assert.throws(() => targetMetadata("https://sfu.example.com", false), /allow-remote-target/);
	assert.equal(targetMetadata("https://sfu.example.com/base", true).loopback, false);
});

test("rotation schedule selects bounded talkers deterministically and keeps the final partial window", () => {
	assert.deepEqual(rotationWindows(["a", "b", "c", "d"], 2, 2500, 1000), [
		{ index: 0, startMs: 0, durationMs: 1000, expectedActiveIds: ["a", "b"] },
		{ index: 1, startMs: 1000, durationMs: 1000, expectedActiveIds: ["c", "d"] },
		{ index: 2, startMs: 2000, durationMs: 500, expectedActiveIds: ["a", "b"] },
	]);
});

test("rotation evaluation uses observed RTP continuity, stable IDs, and stable resources", () => {
	const participant = { userId: "a", producerIdsBefore: ["p1"], producerIdsAfter: ["p1"],
		outboundBytesDelta: 10, expectedInbound: 1, inboundAdvanced: 1 };
	assert.deepEqual(evaluateRotation([{ index: 0, observations: [participant] }],
		[{ producers: 2, consumers: 2 }, { producers: 2, consumers: 2 }]), []);
	assert.match(evaluateRotation([{ index: 0, observations: [{ ...participant, producerIdsAfter: ["p2"], outboundBytesDelta: 0 }] }],
		[{ producers: 2, consumers: 2 }, { producers: 3, consumers: 2 }]).join("; "), /producer IDs changed.*outbound RTP.*resources changed/);
});

test("optional audio-energy deltas remain null when Chromium omits the stat", () => {
	assert.equal(finiteDelta(0.25, 0.75), 0.5);
	assert.equal(finiteDelta(undefined, undefined), null);
});

test("camera evaluation independently requires stable progressing publication, delivery, decode, and resources", () => {
	const publisher = { userId: "a", publisher: true, producerIdsBefore: ["p1"], producerIdsAfter: ["p1"], producerReady: true,
		outboundBytesDelta: 10, framesEncodedDelta: 3, expectedReceivers: 1, receiverCount: 1, inboundAdvanced: 1,
		decodedObserved: 1, decodedAdvanced: 1 };
	assert.deepEqual(evaluateCameras([publisher], [{ producers: 2, consumers: 2 }], { producers: 2, consumers: 2 }), []);
	assert.match(evaluateCameras([{ ...publisher, producerIdsAfter: ["p2"], outboundBytesDelta: 0, framesEncodedDelta: 0,
		receiverCount: 0, inboundAdvanced: 0, decodedAdvanced: 0 }], [{ producers: 1, consumers: 0 }],
	{ producers: 2, consumers: 2 }).join("; "), /not stable.*outbound RTP.*framesEncoded.*received 0\/1.*inbound RTP.*decoded frames.*resources/);
	assert.match(evaluateCameras([{ ...publisher, expectedReceivers: 2, receiverCount: 2, inboundAdvanced: 2,
		decodedObserved: 1, decodedAdvanced: 0 }], [{ producers: 2, consumers: 2 }],
	{ producers: 2, consumers: 2 }).join("; "), /decoded frames advanced for 0\/1 cameras/);
});

test("camera delivery waits for every expected producer and consumer", () => {
	assert.equal(cameraDeliveryReady([{ producerCount: 1, consumerCount: 1 }, { producerCount: 1, consumerCount: 1 }], 2, 2), true);
	assert.equal(cameraDeliveryReady([{ producerCount: 1, consumerCount: 0 }, { producerCount: 1, consumerCount: 1 }], 2, 2), false);
});

test("bounds reject fractions and values outside the declared range", () => {
	assert.equal(boundedInteger("40", "count", 1, 50), 40);
	assert.equal(boundedInteger("150", "count", 1, 150), 150);
	assert.throws(() => boundedInteger("40.5", "count", 1, 50));
	assert.throws(() => boundedInteger("151", "count", 1, 150));
});

test("resource parser ignores unrelated and malformed Prometheus samples", () => {
	const metrics = [
		"# HELP ignored ignored",
		'meet_sfu_resources{resource="rooms"} 1',
		'meet_sfu_resources{resource="producers"} 4',
		'meet_sfu_worker_cpu_seconds{worker="1",mode="user"} 0.25',
		'meet_sfu_worker_cpu_seconds{worker="2",mode="user"} 0.5',
		'meet_sfu_worker_max_resident_memory_bytes{worker="1"} 8000000',
		"meet_sfu_process_process_resident_memory_bytes 12000000",
		'meet_sfu_resources{resource="consumers"} NaN',
		"process_resident_memory_bytes 99",
	].join("\n");
	assert.deepEqual(parseResourceMetrics(metrics), { rooms: 1, producers: 4,
		workerCpuUserSeconds: 0.75, workerMaxResidentMemoryBytes: 8000000,
		processResidentMemoryBytes: 12000000 });
	assert.deepEqual(delta({ rooms: 0, producers: 1 }, { rooms: 1, producers: 4 }), {
		rooms: 1,
		producers: 3,
	});
});

test("percentiles use nearest rank and reports can be checked for JWT leakage", () => {
	assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
	assert.equal(percentile([], 0.95), null);
	assert.equal(containsJwt({ auth: "environment" }), false);
	assert.equal(containsJwt({ value: "eyJhbGciOiJIUzI1NiJ9.e30.signature" }), true);
});
