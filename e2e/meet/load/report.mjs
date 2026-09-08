import { isIP } from "node:net";

export function boundedInteger(value, name, min, max) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	}
	return number;
}

export function targetMetadata(value, allowRemote) {
	const url = new URL(value);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("SFU target must be HTTP(S) without credentials, query, or fragment");
	}
	const loopback = url.hostname === "localhost" || url.hostname === "::1" ||
		(isIP(url.hostname) === 4 && url.hostname.startsWith("127."));
	if (!loopback && !allowRemote) throw new Error("Non-loopback targets require --allow-remote-target");
	if (url.port === "3000") throw new Error("Port 3000 is reserved for the shared SFU; use an isolated target");
	return { endpoint: url.origin + url.pathname.replace(/\/$/, ""), loopback };
}

export function parseResourceMetrics(text) {
	const values = {};
	for (const line of text.split("\n")) {
		const match = line.match(/^([^\s{]+)(?:\{([^}]*)\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i);
		if (!match) continue;
		const number = Number(match[3]);
		const resource = match[2]?.match(/(?:^|,)resource="([a-z]+)"(?:,|$)/)?.[1];
		const mode = match[2]?.match(/(?:^|,)mode="(user|system)"(?:,|$)/)?.[1];
		if (match[1] === "meet_sfu_resources" && resource) values[resource] = number;
		if (match[1] === "meet_sfu_worker_cpu_seconds" && mode) {
			const key = `workerCpu${mode[0].toUpperCase()}${mode.slice(1)}Seconds`;
			values[key] = (values[key] || 0) + number;
		}
		if (match[1] === "meet_sfu_worker_max_resident_memory_bytes") {
			values.workerMaxResidentMemoryBytes = (values.workerMaxResidentMemoryBytes || 0) + number;
		}
		if (match[1] === "meet_sfu_process_process_resident_memory_bytes") values.processResidentMemoryBytes = number;
	}
	return values;
}

export function delta(before, after) {
	return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] ?? 0)]));
}

export function percentile(values, fraction) {
	const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
	return finite.length ? finite[Math.ceil(finite.length * fraction) - 1] : null;
}

export function containsJwt(value) {
	return /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(JSON.stringify(value));
}

export function finiteDelta(before, after) {
	return Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
}

export function rotationWindows(participantIds, talkers, durationMs, intervalMs) {
	const windows = [];
	for (let startMs = 0, index = 0; startMs < durationMs; startMs += intervalMs, index++) {
		windows.push({ index, startMs, durationMs: Math.min(intervalMs, durationMs - startMs),
			expectedActiveIds: Array.from({ length: talkers }, (_, offset) =>
				participantIds[(index * talkers + offset) % participantIds.length]) });
	}
	return windows;
}

export function evaluateRotation(windows, resourceSamples) {
	const errors = [];
	for (const window of windows) {
		for (const participant of window.observations) {
			if (participant.producerIdsBefore.join() !== participant.producerIdsAfter.join())
				errors.push(`window ${window.index}: ${participant.userId} producer IDs changed`);
			if (participant.outboundBytesDelta <= 0)
				errors.push(`window ${window.index}: ${participant.userId} outbound RTP did not advance`);
			if (participant.expectedInbound > 0 && participant.inboundAdvanced !== participant.expectedInbound)
				errors.push(`window ${window.index}: ${participant.userId} inbound RTP advanced for ${participant.inboundAdvanced}/${participant.expectedInbound} publishers`);
		}
	}
	const expected = resourceSamples[0];
	if (resourceSamples.some((sample) => sample.producers !== expected.producers || sample.consumers !== expected.consumers))
		errors.push("producer or consumer resources changed during rotation");
	return errors;
}

export function evaluateCameras(observations, resourceSamples, expected) {
	const errors = [];
	for (const participant of observations) {
		if (participant.publisher) {
			if (participant.producerIdsBefore.join() !== participant.producerIdsAfter.join() || participant.producerIdsAfter.length !== 1)
				errors.push(`${participant.userId}: camera Producer was not stable`);
			if (!participant.producerReady) errors.push(`${participant.userId}: camera Producer was not enabled and unpaused`);
			if (participant.outboundBytesDelta <= 0) errors.push(`${participant.userId}: camera outbound RTP did not advance`);
			if (participant.framesEncodedDelta !== null && participant.framesEncodedDelta <= 0)
				errors.push(`${participant.userId}: camera framesEncoded did not advance`);
		} else if (participant.producerIdsAfter.length) errors.push(`${participant.userId}: idle participant published media`);
		if (participant.receiverCount !== participant.expectedReceivers)
			errors.push(`${participant.userId}: received ${participant.receiverCount}/${participant.expectedReceivers} camera tracks`);
		if (participant.inboundAdvanced !== participant.expectedReceivers)
			errors.push(`${participant.userId}: inbound RTP advanced for ${participant.inboundAdvanced}/${participant.expectedReceivers} cameras`);
		if (participant.decodedAvailable && participant.decodedAdvanced !== participant.expectedReceivers)
			errors.push(`${participant.userId}: decoded frames advanced for ${participant.decodedAdvanced}/${participant.expectedReceivers} cameras`);
	}
	if (resourceSamples.some((sample) => sample.producers !== expected.producers || sample.consumers !== expected.consumers))
		errors.push("camera Producer or Consumer resources were not stable at expected counts");
	return errors;
}
