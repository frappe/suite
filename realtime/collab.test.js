const assert = require("node:assert/strict");
const { test } = require("node:test");

const registerHandlers = require("./handlers");
const { held } = require("./collab");

const room = (letter) => `sc:${letter.repeat(32)}`;
const A = room("A");
const B = room("B");
const C = room("C");
const tick = () => new Promise((resolve) => setTimeout(resolve, 150));

let sites = 0;
// A site's namespace: its rooms, and what the site answers when asked whether collab is on
function site(on = true) {
	const rooms = new Map();
	const nsp = {
		name: `/site-${sites++}.localhost`,
		adapter: { rooms },
		asked: 0,
		on,
		to(name) {
			return { emit: (event, message) => [...(rooms.get(name) ?? [])].forEach((socket) => socket.heard.push([event, message])) };
		},
	};
	return nsp;
}

function connect(nsp, user = "a@example.com", faults = {}) {
	const handlers = new Map();
	const socket = {
		user,
		nsp,
		heard: [],
		emit() {},
		on(event, handler) {
			handlers.set(event, handler);
		},
		join(name) {
			if (faults.join) throw new Error("join");
			if (!nsp.adapter.rooms.has(name)) nsp.adapter.rooms.set(name, new Set());
			nsp.adapter.rooms.get(name).add(socket);
		},
		leave(name) {
			nsp.adapter.rooms.get(name)?.delete(socket);
			if (!nsp.adapter.rooms.get(name)?.size) nsp.adapter.rooms.delete(name);
		},
		to(name) {
			if (faults.to) throw new Error("to");
			return {
				emit: (event, message) =>
					[...(nsp.adapter.rooms.get(name) ?? [])]
						.filter((other) => other !== socket)
						.forEach((other) => other.heard.push([event, message])),
			};
		},
		frappe_request: async (url) => {
			if (url.endsWith("validate_guest_session")) return { json: async () => ({ data: { valid: true } }) };
			nsp.asked++;
			if (faults.request) throw new Error("request");
			return { json: async () => ({ data: nsp.on }) };
		},
	};
	registerHandlers(socket);
	return {
		socket,
		handlers,
		rooms: (rooms) => new Promise((resolve) => handlers.get("suite_collab_rooms")({ rooms }, resolve)),
		presence: (rooms, state) => handlers.get("suite_collab_presence")({ rooms, state }),
		close: () => handlers.get("disconnect")(),
		heard: (event) => socket.heard.filter(([name]) => name === event).map(([, message]) => message),
	};
}

test("a socket's room set replaces the last one and it is told who is already there", async () => {
	const nsp = site();
	const first = connect(nsp, "first@example.com");
	const second = connect(nsp, "second@example.com");
	await first.rooms([A, B]);

	const ack = await second.rooms([A]);
	await first.rooms([B, C]);

	assert.ok(ack.pid >= 2 ** 31 && ack.pid < 2 ** 32);
	assert.deepEqual(ack.rooms, [A]);
	assert.deepEqual(
		ack.roster.map((entry) => [entry.room, entry.user]),
		[[A, "first@example.com"]],
	);
	assert.deepEqual([...nsp.adapter.rooms.keys()].sort(), [A, B, C].sort());
	assert.equal(nsp.adapter.rooms.get(A).has(first.socket), false);
	assert.deepEqual(
		second.heard("suite_collab_presence_gone").map((gone) => gone.room),
		[A],
	);
	first.close();
	second.close();
});

test("a room set that is too big or names something other than a collab room joins nothing", async () => {
	const nsp = site();
	const tab = connect(nsp);

	const answers = [
		await tab.rooms([..."ABCDEFGHI"].map(room)),
		await tab.rooms(["guest:guest_12345"]),
		await tab.rooms(`${A}`),
		await tab.rooms([`${A}x`]),
	];

	assert.deepEqual(answers, Array(4).fill({ error: "invalid_request" }));
	assert.equal(nsp.adapter.rooms.size, 0);
	tab.close();
});

test("with collaboration off every join is refused, and the site is asked once per half minute", async () => {
	const nsp = site(false);
	const tabs = Array.from({ length: 20 }, () => connect(nsp));

	const answers = await Promise.all(tabs.map((tab) => tab.rooms([A])));

	assert.deepEqual(answers, Array(20).fill({ error: "disabled" }));
	assert.equal(nsp.adapter.rooms.size, 0);
	assert.equal(nsp.asked, 1);
	tabs.forEach((tab) => tab.close());
});

test("presence carries the user the server verified, never one the tab names", async () => {
	const nsp = site();
	const writer = connect(nsp, "writer@example.com");
	const guest = connect(nsp, "Guest");
	const watcher = connect(nsp, "watcher@example.com");
	await watcher.rooms([A]);
	await writer.rooms([A]);
	await guest.rooms([A]);

	writer.presence([A], { user: { name: "Someone else" }, cursor: { anchor: 1, head: 1 } });
	guest.presence([A], { user: "admin@example.com", cursor: null });
	await tick();

	const joins = watcher.heard("suite_collab_presence_join").map((join) => join.user);
	const states = watcher.heard("suite_collab_presence").flatMap((batch) => batch.states);
	assert.deepEqual(joins, ["writer@example.com", "Guest"]);
	assert.deepEqual(
		states.map((state) => state.user),
		["writer@example.com", "Guest"],
	);
	[writer, guest, watcher].forEach((tab) => tab.close());
});

test("a room hears a tab's latest presence once per tick", async () => {
	const nsp = site();
	const writer = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await writer.rooms([A]);
	await watcher.rooms([A]);

	for (const at of [1, 2, 3]) writer.presence([A], { cursor: { at } });
	await tick();

	const batches = watcher.heard("suite_collab_presence");
	assert.equal(batches.length, 1);
	assert.deepEqual(
		batches[0].states.map((state) => [state.n, state.state.cursor.at]),
		[[3, 3]],
	);
	writer.close();
	watcher.close();
});

test("presence past fifty messages a second, over 2 KiB or for a room not joined is ignored", async () => {
	const nsp = site();
	const flooder = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await flooder.rooms([A]);
	await watcher.rooms([A]);

	const start = Date.now();
	for (let at = 1; at <= 500; at++) flooder.presence([A], { cursor: { at } });
	flooder.presence([A, B], { cursor: { at: "elsewhere" } });
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 1000 - ((Date.now() - start) % 1000) + 10));
	flooder.presence([A], { cursor: { at: "big" }, padding: "x".repeat(2048) });
	await tick();

	const states = watcher.heard("suite_collab_presence").flatMap((batch) => batch.states);
	assert.ok(states.at(-1).n <= 2 * 50, `${states.at(-1).n} messages counted`);
	assert.equal(
		states.some((state) => ["elsewhere", "big"].includes(state.state.cursor.at)),
		false,
	);
	flooder.close();
	watcher.close();
});

test("a tab that joins late is answered with the carets already in its rooms, each naming its room", async () => {
	const nsp = site();
	const writer = connect(nsp, "writer@example.com");
	await writer.rooms([A, B]);
	writer.presence([A], { cursor: { at: 1 } });
	await tick();

	const late = connect(nsp, "late@example.com");
	const ack = await late.rooms([A, B]);

	assert.deepEqual(
		ack.carets.map((caret) => [caret.room, caret.user, caret.state.cursor.at]),
		[[A, "writer@example.com", 1]],
	);
	writer.close();
	late.close();
});

test("a room shows at most fifty carets, ten of them guests", async () => {
	const nsp = site();
	const watcher = connect(nsp, "watcher@example.com");
	await watcher.rooms([A]);
	const tabs = [
		...Array.from({ length: 20 }, () => connect(nsp, "Guest")),
		...Array.from({ length: 50 }, (_, index) => connect(nsp, `user${index}@example.com`)),
	];
	for (const tab of tabs) await tab.rooms([A]);

	tabs.forEach((tab) => tab.presence([A], { cursor: { anchor: 1, head: 1 } }));
	await tick();

	const states = watcher.heard("suite_collab_presence").flatMap((batch) => batch.states);
	const carets = states.filter((state) => state.state.cursor);
	assert.equal(states.length, 70);
	assert.equal(carets.length, 50);
	assert.equal(carets.filter((state) => state.user === "Guest").length, 10);
	[watcher, ...tabs].forEach((tab) => tab.close());
});

test("presence held stays bounded over a thousand reconnects and is gone when everyone leaves", async () => {
	const nsp = site();
	const empty = held();
	const writer = connect(nsp);
	await writer.rooms([A, B]);
	const before = held();

	for (let round = 0; round < 1000; round++) {
		const tab = connect(nsp, round % 2 ? "Guest" : "reader@example.com");
		await tab.rooms([A, B]);
		tab.presence([A, B], { cursor: { at: round } });
		tab.close();
	}
	const during = held();
	await tick();
	writer.close();
	await tick();

	assert.ok(during <= before + 2, `${during} held after reconnects, ${before} before`);
	assert.equal(held(), empty);
	assert.deepEqual(writer.heard("suite_collab_presence_gone").length, 2000);
});

test("a fault in every collab listener and timer leaves the process serving and Meet answering", async () => {
	const escaped = [];
	const record = (error) => escaped.push(error);
	process.on("uncaughtException", record);
	process.on("unhandledRejection", record);
	try {
		const nsp = site();
		const hostile = new Proxy(
			{},
			{
				get() {
					throw new Error("payload");
				},
			},
		);
		const tabs = [
			connect(nsp, "a@example.com", { join: true }),
			connect(nsp, "b@example.com", { to: true }),
			connect(nsp, "c@example.com", { request: true }),
		];
		const healthy = connect(nsp, "d@example.com");
		await healthy.rooms([A]);
		const answers = [];
		for (const tab of tabs) {
			answers.push(await tab.rooms([A]));
			tab.handlers.get("suite_collab_rooms")(hostile, () => {
				throw new Error("ack");
			});
			tab.handlers.get("suite_collab_rooms")({ rooms: [A] }, () => Promise.reject(new Error("ack")));
			tab.handlers.get("suite_collab_presence")(hostile);
			tab.presence([A], { cursor: { big: 10n } });
			tab.presence([A], { cursor: { at: 1 } });
		}
		healthy.presence([A], { cursor: { at: 1 } });
		const emit = nsp.to;
		nsp.to = () => {
			throw new Error("flush");
		};
		await tick();
		nsp.to = emit;
		for (const tab of tabs) tab.handlers.get("disconnect")();
		healthy.handlers.get("disconnect")();

		const meet = await new Promise((resolve) =>
			tabs[1].handlers.get("guest_subscribe")(
				{ guest_id: "guest_12345", meeting_id: "room-1", guest_session_token: "proof" },
				resolve,
			),
		);
		healthy.presence([A], { cursor: { at: 2 } });
		await tick();

		assert.deepEqual(escaped, []);
		assert.deepEqual(meet, { ok: true });
		assert.ok(answers.every((answer) => answer.error || answer.pid));
	} finally {
		process.off("uncaughtException", record);
		process.off("unhandledRejection", record);
	}
});
