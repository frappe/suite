const assert = require("node:assert/strict");
const { test } = require("node:test");

const registerHandlers = require("./handlers");

function createSocket(validationResponse) {
	const handlers = new Map();
	const joinedRooms = [];
	const socket = {
		emit() {},
		frappe_request: async () => ({
			json: async () => validationResponse,
		}),
		join(room) {
			joinedRooms.push(room);
		},
		leave() {},
		on(event, handler) {
			handlers.set(event, handler);
		},
	};

	registerHandlers(socket);
	return { handlers, joinedRooms };
}

test("guest_subscribe ignores responses without validation data", async () => {
	const { handlers, joinedRooms } = createSocket({});

	await handlers.get("guest_subscribe")("guest_12345");
	await new Promise(setImmediate);

	assert.deepEqual(joinedRooms, []);
});

test("guest_subscribe joins the validated guest room", async () => {
	const { handlers, joinedRooms } = createSocket({ message: { valid: true } });

	await handlers.get("guest_subscribe")("guest_12345");
	await new Promise(setImmediate);

	assert.deepEqual(joinedRooms, ["guest:guest_12345"]);
});
