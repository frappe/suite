const assert = require("node:assert/strict");
const { test } = require("node:test");

const registerHandlers = require("./handlers");

function createSocket(options = {}) {
	const handlers = new Map();
	const joinedRooms = [];
	const leftRooms = [];
	const requests = [];
	let responseIndex = 0;
	const socket = {
		emit() {},
		frappe_request: async (url, params, requestOptions) => {
			requests.push({ url, params, requestOptions });
			if (options.requestError) throw options.requestError;
			return {
				json: async () => {
					if (options.jsonError) throw options.jsonError;
					return (
						options.responses?.[responseIndex++] ??
						options.response ?? { message: { valid: true, status: "pending" } }
					);
				},
			};
		},
		join(room) {
			if (options.joinError) throw options.joinError;
			joinedRooms.push(room);
		},
		leave(room) {
			if (options.leaveError) throw options.leaveError;
			leftRooms.push(room);
		},
		on(event, handler) {
			handlers.set(event, handler);
		},
	};

	registerHandlers(socket);
	return { handlers, joinedRooms, leftRooms, requests };
}

const subscription = {
	guest_id: "guest_12345",
	meeting_id: "room-1",
	guest_session_token: "private-proof",
};

test("guest_subscribe validates structured proof before joining", async () => {
	const fixture = createSocket();
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(fixture.joinedRooms, ["guest:guest_12345"]);
	assert.equal(
		fixture.requests[0].url,
		"/api/method/suite.meet.api.meeting.validate_guest_session",
	);
	assert.equal(fixture.requests[0].url.includes("private-proof"), false);
	assert.deepEqual(fixture.requests[0].params, {});
	assert.equal(fixture.requests[0].requestOptions.method, "POST");
	assert.equal(
		fixture.requests[0].requestOptions.body.toString(),
		new URLSearchParams(subscription).toString(),
	);
	assert.deepEqual(acknowledgement, { ok: true, status: "pending" });
});

test("guest_subscribe rejects missing proof", async () => {
	const fixture = createSocket();
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(
		{ guest_id: "guest_12345", meeting_id: "room-1" },
		(value) => {
			acknowledgement = value;
		},
	);

	assert.deepEqual(fixture.joinedRooms, []);
	assert.deepEqual(fixture.requests, []);
	assert.deepEqual(acknowledgement, { ok: false, error: "invalid_request" });
});

test("guest_subscribe rejects wrong-room or invalid proof response", async () => {
	const fixture = createSocket({ response: { message: { valid: false } } });
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(fixture.joinedRooms, []);
	assert.deepEqual(acknowledgement, { ok: false, error: "unauthorized" });
});

test("guest_subscribe propagates proof-bound terminal status without joining", async () => {
	const fixture = createSocket({
		response: { message: { valid: false, status: "rejected" } },
	});
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(fixture.joinedRooms, []);
	assert.deepEqual(acknowledgement, {
		ok: false,
		error: "unauthorized",
		status: "rejected",
	});
});

test("guest_subscribe acknowledges admission that races with room join", async () => {
	const fixture = createSocket({
		responses: [
			{ message: { valid: true, status: "pending" } },
			{ message: { valid: true, status: "admitted" } },
		],
	});
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.equal(fixture.requests.length, 2);
	assert.deepEqual(fixture.joinedRooms, ["guest:guest_12345"]);
	assert.deepEqual(fixture.leftRooms, []);
	assert.deepEqual(acknowledgement, { ok: true, status: "admitted" });
});

test("guest_subscribe leaves and acknowledges rejection that races with room join", async () => {
	const fixture = createSocket({
		responses: [
			{ message: { valid: true, status: "pending" } },
			{ message: { valid: false, status: "rejected" } },
		],
	});
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.equal(fixture.requests.length, 2);
	assert.deepEqual(fixture.joinedRooms, ["guest:guest_12345"]);
	assert.deepEqual(fixture.leftRooms, ["guest:guest_12345"]);
	assert.deepEqual(acknowledgement, {
		ok: false,
		error: "unauthorized",
		status: "rejected",
	});
});

test("guest_subscribe acknowledges malformed validation responses", async () => {
	const fixture = createSocket({ response: {} });
	let acknowledgement;

	await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(fixture.joinedRooms, []);
	assert.deepEqual(acknowledgement, { ok: false, error: "unauthorized" });
});

test("guest_subscribe catches request and JSON errors", async () => {
	for (const options of [
		{ requestError: new Error("offline") },
		{ jsonError: new Error("bad json") },
		{ joinError: new Error("join failed") },
	]) {
		const fixture = createSocket(options);
		let acknowledgement;
		await fixture.handlers.get("guest_subscribe")(subscription, (value) => {
			acknowledgement = value;
		});
		assert.deepEqual(fixture.joinedRooms, []);
		assert.deepEqual(acknowledgement, { ok: false, error: "validation_failed" });
	}
});

test("guest handlers ignore non-function and throwing acknowledgements", async () => {
	const fixture = createSocket();

	await assert.doesNotReject(
		fixture.handlers.get("guest_subscribe")(subscription, { untrusted: true }),
	);
	await assert.doesNotReject(
		fixture.handlers.get("guest_unsubscribe")(subscription, () => {
			throw new Error("untrusted callback");
		}),
	);
	await assert.doesNotReject(
		fixture.handlers.get("guest_subscribe")(subscription, async () => {
			throw new Error("untrusted async callback");
		}),
	);
});

test("guest_unsubscribe validates proof before leaving", async () => {
	const fixture = createSocket();
	let acknowledgement;

	await fixture.handlers.get("guest_unsubscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(fixture.leftRooms, ["guest:guest_12345"]);
	assert.deepEqual(acknowledgement, { ok: true, status: "pending" });
});

test("guest_unsubscribe permits every recognized proof-bound status", async () => {
	for (const status of ["pending", "admitted", "expired", "rejected", "banned"]) {
		const fixture = createSocket({
			response: {
				message: {
					valid: ["pending", "admitted"].includes(status),
					status,
				},
			},
		});
		let acknowledgement;

		await fixture.handlers.get("guest_unsubscribe")(subscription, (value) => {
			acknowledgement = value;
		});

		assert.deepEqual(fixture.leftRooms, ["guest:guest_12345"]);
		assert.deepEqual(acknowledgement, { ok: true, status });
	}
});

test("guest_unsubscribe rejects invalid proof without a status", async () => {
	for (const response of [
		{ message: { valid: false } },
		{ message: { valid: false, status: "unrecognized" } },
	]) {
		const fixture = createSocket({ response });

		await fixture.handlers.get("guest_unsubscribe")(subscription);

		assert.deepEqual(fixture.leftRooms, []);
	}
});

test("guest_unsubscribe catches leave errors", async () => {
	const fixture = createSocket({ leaveError: new Error("leave failed") });
	let acknowledgement;

	await fixture.handlers.get("guest_unsubscribe")(subscription, (value) => {
		acknowledgement = value;
	});

	assert.deepEqual(acknowledgement, {
		ok: false,
		error: "validation_failed",
	});
});
