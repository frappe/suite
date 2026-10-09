const assert = require("node:assert/strict");
const { test } = require("node:test");

const registerHandlers = require("./handlers");
const { held_entries } = require("./collab");

const room = (letter) => `sc:${letter.repeat(32)}`;
const roomA = room("A");
const roomB = room("B");
const roomC = room("C");
const waitForFlush = () => new Promise((resolve) => setTimeout(resolve, 150));

let siteCount = 0;
// A site's namespace: its rooms, and what the site answers when asked whether collab is on
function fakeSite(collabEnabled = true) {
	const rooms = new Map();
	const nsp = {
		name: `/site-${siteCount++}.localhost`,
		adapter: { rooms },
		joinableAsks: 0,
		collabEnabled,
		to(name) {
			const emit = (event, message) => {
				for (const socket of rooms.get(name) ?? []) {
					socket.heard.push([event, message]);
				}
			};
			return { emit };
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
			if (faults.join) {
				throw new Error("join");
			}

			if (!nsp.adapter.rooms.has(name)) {
				nsp.adapter.rooms.set(name, new Set());
			}
			nsp.adapter.rooms.get(name).add(socket);
		},
		leave(name) {
			nsp.adapter.rooms.get(name)?.delete(socket);
			if (!nsp.adapter.rooms.get(name)?.size) {
				nsp.adapter.rooms.delete(name);
			}
		},
		to(name) {
			if (faults.to) {
				throw new Error("to");
			}

			const emit = (event, message) => {
				const others = [...(nsp.adapter.rooms.get(name) ?? [])].filter((other) => other !== socket);
				for (const other of others) {
					other.heard.push([event, message]);
				}
			};
			return { emit };
		},
		frappe_request: async (url) => {
			if (url.endsWith("validate_guest_session")) {
				return { json: async () => ({ data: { valid: true } }) };
			}

			nsp.joinableAsks++;
			if (faults.request) {
				throw new Error("request");
			}

			return { json: async () => ({ data: nsp.collabEnabled }) };
		},
	};
	registerHandlers(socket);
	return {
		socket,
		handlers,
		joinRooms: (rooms) =>
			new Promise((resolve) => handlers.get("suite_collab_rooms")({ rooms }, resolve)),
		sendPresence: (rooms, state) => handlers.get("suite_collab_presence")({ rooms, state }),
		close: () => handlers.get("disconnect")(),
		heard: (event) => socket.heard.filter(([name]) => name === event).map(([, message]) => message),
	};
}

test("a socket's room set replaces the last one and it is told who is already there", async () => {
	const nsp = fakeSite();
	const first = connect(nsp, "first@example.com");
	const second = connect(nsp, "second@example.com");
	await first.joinRooms([roomA, roomB]);

	const joinReply = await second.joinRooms([roomA]);
	await first.joinRooms([roomB, roomC]);

	assert.ok(joinReply.pid >= 2 ** 31 && joinReply.pid < 2 ** 32);
	assert.deepEqual(joinReply.rooms, [roomA]);
	assert.deepEqual(
		joinReply.roster.map((entry) => [entry.room, entry.user]),
		[[roomA, "first@example.com"]],
	);
	assert.deepEqual([...nsp.adapter.rooms.keys()].sort(), [roomA, roomB, roomC].sort());
	assert.equal(nsp.adapter.rooms.get(roomA).has(first.socket), false);
	assert.deepEqual(
		second.heard("suite_collab_presence_gone").map((gone) => gone.room),
		[roomA],
	);
	first.close();
	second.close();
});

test("a room set that is too big or names something other than a collab room joins nothing", async () => {
	const nsp = fakeSite();
	const tab = connect(nsp);

	const answers = [
		await tab.joinRooms([..."ABCDEFGHI"].map(room)),
		await tab.joinRooms(["guest:guest_12345"]),
		await tab.joinRooms(`${roomA}`),
		await tab.joinRooms([`${roomA}x`]),
	];

	assert.deepEqual(answers, Array(4).fill({ error: "invalid_request" }));
	assert.equal(nsp.adapter.rooms.size, 0);
	tab.close();
});

test("with collaboration off every join is refused, and the site is asked once per half minute", async () => {
	const nsp = fakeSite(false);
	const tabs = Array.from({ length: 20 }, () => connect(nsp));

	const answers = await Promise.all(tabs.map((tab) => tab.joinRooms([roomA])));

	assert.deepEqual(answers, Array(20).fill({ error: "disabled" }));
	assert.equal(nsp.adapter.rooms.size, 0);
	assert.equal(nsp.joinableAsks, 1);
	tabs.forEach((tab) => tab.close());
});

test("presence carries the user the server verified, never one the tab names", async () => {
	const nsp = fakeSite();
	const writer = connect(nsp, "writer@example.com");
	const guest = connect(nsp, "Guest");
	const watcher = connect(nsp, "watcher@example.com");
	await watcher.joinRooms([roomA]);
	await writer.joinRooms([roomA]);
	await guest.joinRooms([roomA]);

	writer.sendPresence([roomA], { user: { name: "Someone else" }, cursor: { anchor: 1, head: 1 } });
	guest.sendPresence([roomA], { user: "admin@example.com", cursor: null });
	await waitForFlush();

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
	const nsp = fakeSite();
	const writer = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await writer.joinRooms([roomA]);
	await watcher.joinRooms([roomA]);

	for (const at of [1, 2, 3]) {
		writer.sendPresence([roomA], { cursor: { at } });
	}
	await waitForFlush();

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
	const nsp = fakeSite();
	const flooder = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await flooder.joinRooms([roomA]);
	await watcher.joinRooms([roomA]);

	const start = Date.now();
	for (let at = 1; at <= 500; at++) {
		flooder.sendPresence([roomA], { cursor: { at } });
	}
	flooder.sendPresence([roomA, roomB], { cursor: { at: "elsewhere" } });
	await waitForFlush();
	const untilNextSecond = 1000 - ((Date.now() - start) % 1000) + 10;
	await new Promise((resolve) => setTimeout(resolve, untilNextSecond));
	flooder.sendPresence([roomA], { cursor: { at: "big" }, padding: "x".repeat(2048) });
	await waitForFlush();

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
	const nsp = fakeSite();
	const writer = connect(nsp, "writer@example.com");
	await writer.joinRooms([roomA, roomB]);
	writer.sendPresence([roomA], { cursor: { at: 1 } });
	await waitForFlush();

	const late = connect(nsp, "late@example.com");
	const joinReply = await late.joinRooms([roomA, roomB]);

	assert.deepEqual(
		joinReply.carets.map((caret) => [caret.room, caret.user, caret.state.cursor.at]),
		[[roomA, "writer@example.com", 1]],
	);
	writer.close();
	late.close();
});

test("a room shows at most fifty carets, ten of them guests", async () => {
	const nsp = fakeSite();
	const watcher = connect(nsp, "watcher@example.com");
	await watcher.joinRooms([roomA]);
	const tabs = [
		...Array.from({ length: 20 }, () => connect(nsp, "Guest")),
		...Array.from({ length: 50 }, (_, index) => connect(nsp, `user${index}@example.com`)),
	];
	for (const tab of tabs) {
		await tab.joinRooms([roomA]);
	}

	tabs.forEach((tab) => tab.sendPresence([roomA], { cursor: { anchor: 1, head: 1 } }));
	await waitForFlush();

	const states = watcher.heard("suite_collab_presence").flatMap((batch) => batch.states);
	const carets = states.filter((state) => state.state.cursor);
	assert.equal(states.length, 70);
	assert.equal(carets.length, 50);
	assert.equal(carets.filter((state) => state.user === "Guest").length, 10);
	[watcher, ...tabs].forEach((tab) => tab.close());
});

test("a room named over and over or a huge state is turned away before any work, and a room named twice counts once", async () => {
	const nsp = fakeSite();
	const flooder = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await flooder.joinRooms([roomA]);
	await watcher.joinRooms([roomA]);
	const repeated = Array(26000).fill(roomA);
	const huge = {
		cursor: { at: "huge" },
		padding: Array(100000).fill("x".repeat(10)),
	};

	const start = process.hrtime.bigint();
	for (let at = 0; at < 24; at++) {
		flooder.handlers.get("suite_collab_presence")({ rooms: repeated, state: { cursor: { at } } });
		flooder.sendPresence([roomA], huge);
	}
	const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
	flooder.sendPresence([roomA, roomA], { cursor: { at: "twice" } });
	await waitForFlush();

	const states = watcher.heard("suite_collab_presence").flatMap((batch) => batch.states);
	assert.ok(elapsedMs < 20, `${elapsedMs} ms for 48 hostile messages`);
	assert.deepEqual(
		states.map((state) => [state.n, state.state.cursor.at]),
		[[1, "twice"]],
	);
	flooder.close();
	watcher.close();
});

test("a tab that keeps changing its room set is held to the presence budget", async () => {
	const nsp = fakeSite();
	const toggler = connect(nsp);
	const watcher = connect(nsp, "watcher@example.com");
	await watcher.joinRooms([roomA]);

	const start = Date.now();
	const replies = [];
	for (let round = 0; round < 200; round++) {
		const rooms = round % 2 ? [] : [roomA];
		replies.push(await toggler.joinRooms(rooms));
	}
	const withinOneSecond = Date.now() - start < 1000;

	const joins = watcher.heard("suite_collab_presence_join").length;
	const leaves = watcher.heard("suite_collab_presence_gone").length;
	const churn = joins + leaves;
	assert.ok(!withinOneSecond || churn <= 50, `${churn} joins and leaves heard`);
	assert.ok(replies.filter((answer) => answer.error === "rate_limited").length >= 150);
	toggler.close();
	watcher.close();
});

test("presence held stays bounded over a thousand reconnects and is gone when everyone leaves", async () => {
	const nsp = fakeSite();
	const heldWhenEmpty = held_entries();
	const writer = connect(nsp);
	await writer.joinRooms([roomA, roomB]);
	const heldWithWriter = held_entries();

	for (let round = 0; round < 1000; round++) {
		const tab = connect(nsp, round % 2 ? "Guest" : "reader@example.com");
		await tab.joinRooms([roomA, roomB]);
		tab.sendPresence([roomA, roomB], { cursor: { at: round } });
		tab.close();
	}
	const heldAfterReconnects = held_entries();
	await waitForFlush();
	writer.close();
	await waitForFlush();

	assert.ok(
		heldAfterReconnects <= heldWithWriter + 2,
		`${heldAfterReconnects} held after reconnects, ${heldWithWriter} before`,
	);
	assert.equal(held_entries(), heldWhenEmpty);
	assert.deepEqual(writer.heard("suite_collab_presence_gone").length, 2000);
});

test("a fault in every collab listener and timer leaves the process serving and Meet answering", async () => {
	const escaped = [];
	const recordEscape = (error) => escaped.push(error);
	process.on("uncaughtException", recordEscape);
	process.on("unhandledRejection", recordEscape);
	try {
		const nsp = fakeSite();
		const throwOnRead = {
			get() {
				throw new Error("payload");
			},
		};
		const throwingPayload = new Proxy({}, throwOnRead);
		const throwingAck = () => {
			throw new Error("ack");
		};
		const tabs = [
			connect(nsp, "a@example.com", { join: true }),
			connect(nsp, "b@example.com", { to: true }),
			connect(nsp, "c@example.com", { request: true }),
		];
		const healthy = connect(nsp, "d@example.com");
		await healthy.joinRooms([roomA]);
		const answers = [];
		for (const tab of tabs) {
			answers.push(await tab.joinRooms([roomA]));
			tab.handlers.get("suite_collab_rooms")(throwingPayload, throwingAck);
			tab.handlers.get("suite_collab_rooms")({ rooms: [roomA] }, () =>
				Promise.reject(new Error("ack")),
			);
			tab.handlers.get("suite_collab_presence")(throwingPayload);
			tab.sendPresence([roomA], { cursor: { big: 10n } });
			tab.sendPresence([roomA], { cursor: { at: 1 } });
		}
		healthy.sendPresence([roomA], { cursor: { at: 1 } });
		const originalTo = nsp.to;
		nsp.to = () => {
			throw new Error("flush");
		};
		await waitForFlush();
		nsp.to = originalTo;
		for (const tab of tabs) {
			tab.handlers.get("disconnect")();
		}
		healthy.handlers.get("disconnect")();

		const subscription = {
			guest_id: "guest_12345",
			meeting_id: "room-1",
			guest_session_token: "proof",
		};
		const meetReply = await new Promise((resolve) =>
			tabs[1].handlers.get("guest_subscribe")(subscription, resolve),
		);
		healthy.sendPresence([roomA], { cursor: { at: 2 } });
		await waitForFlush();

		assert.deepEqual(escaped, []);
		assert.deepEqual(meetReply, { ok: true });
		assert.ok(answers.every((answer) => answer.error || answer.pid));
	} finally {
		process.off("uncaughtException", recordEscape);
		process.off("unhandledRejection", recordEscape);
	}
});
