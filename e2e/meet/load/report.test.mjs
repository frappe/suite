import assert from "node:assert/strict";
import test from "node:test";
import { boundedInteger, containsJwt, delta, parseResourceMetrics, percentile, targetMetadata } from "./report.mjs";

test("target safety defaults to loopback and rejects shared or remote targets", () => {
	assert.deepEqual(targetMetadata("http://127.0.0.1:4317/", false), {
		endpoint: "http://127.0.0.1:4317",
		loopback: true,
	});
	assert.throws(() => targetMetadata("http://127.0.0.1:3000", false), /shared SFU/);
	assert.throws(() => targetMetadata("https://sfu.example.com", false), /allow-remote-target/);
	assert.equal(targetMetadata("https://sfu.example.com/base", true).loopback, false);
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
