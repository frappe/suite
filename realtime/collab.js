// Live collaboration rooms. This process is shared with Meet and every other app,
// so no listener or timer here may throw or leave a promise unhandled
const crypto = require("node:crypto");
const send_reply = require("./acknowledge");

const ROOM_PATTERN = /^sc:[A-Za-z0-9_-]{32}$/;
const ROOMS_MAX = 8;
const STATE_BYTES_MAX = 2048;
const FLUSH_MS = 100;
const MESSAGES_PER_SECOND = 50;
const CARETS_MAX = 50;
const GUEST_CARETS_MAX = 10;
const ROSTER_MAX = 50;
const WRITES_PER_SECOND = 20000;
const JOINABLE_CACHE_MS = 30000;
const MS_PER_SECOND = 1000;
const PID_FLOOR = 2 ** 31;
const JSON_WRAPPER_BYTES = 2;
const JSON_KEY_EXTRA_BYTES = 4;

// Per site: room -> Map(pid -> entry), and room -> the pids changed since the last flush
const sites = new Map();
// Per site: whether sockets may join, asked of the site at most every 30 s
const joinableBySite = new Map();
let flushTimer = null;
// Counts sockets as they first ask for rooms, so every tab ranks the people in a room the same way
let arrivals = 0;

function is_room(room) {
	return typeof room === "string" && ROOM_PATTERN.test(room);
}

function has_caret_slot(members, entry) {
	if (entry.hasCaret) {
		return true;
	}

	let caretCount = 0;
	let guestCaretCount = 0;
	for (const other of members.values()) {
		if (!other.hasCaret) continue;

		caretCount++;
		if (other.isGuest) {
			guestCaretCount++;
		}
	}

	const guestFits = !entry.isGuest || guestCaretCount < GUEST_CARETS_MAX;
	return caretCount < CARETS_MAX && guestFits;
}

function string_bytes(text, budget) {
	if (text.length > budget) {
		return text.length;
	}

	return Buffer.byteLength(text);
}

function queue_items(items, pending, budget) {
	let spent = 0;
	for (let at = 0; at < items.length && budget - spent >= 0; at++, spent++) {
		pending.push(items[at]);
	}

	return spent;
}

function queue_fields(fields, pending, budget) {
	let spent = 0;
	for (const key in fields) {
		spent += key.length + JSON_KEY_EXTRA_BYTES;
		pending.push(fields[key]);
		if (budget - spent < 0) break;
	}

	return spent;
}

function part_bytes(part, pending, budget) {
	if (typeof part === "string") {
		return string_bytes(part, budget);
	}

	if (Array.isArray(part)) {
		return queue_items(part, pending, budget);
	}

	if (part && typeof part === "object") {
		return queue_fields(part, pending, budget);
	}

	return 0;
}

// Whether a value's JSON can fit in `budget` bytes, reading no further than that
function json_fits(value, budget) {
	const pending = [value];
	let remaining = budget;
	while (pending.length && remaining >= 0) {
		const part = pending.pop();
		remaining -= JSON_WRAPPER_BYTES;
		const partBytes = part_bytes(part, pending, remaining);
		remaining -= partBytes;
	}

	return remaining >= 0;
}

function is_presence_state(state) {
	const isObject = !!state && typeof state === "object" && !Array.isArray(state);
	if (!isObject) {
		return false;
	}

	return json_fits(state, STATE_BYTES_MAX) && Buffer.byteLength(JSON.stringify(state)) <= STATE_BYTES_MAX;
}

async function fetch_joinable(socket) {
	const response = await socket.frappe_request("/api/v2/method/suite.content.live.joinable");
	if (!response.ok) {
		throw new Error(`The collab check answered ${response.status}`);
	}

	const body = await response.json();
	return body?.data === true;
}

async function site_allows_join(socket) {
	const siteName = socket.nsp.name;
	const now = Date.now();
	const known = joinableBySite.get(siteName);
	if (known && known.until > now) {
		return known.answer;
	}

	const answer = fetch_joinable(socket);
	const cached = {
		answer,
		until: now + JOINABLE_CACHE_MS,
	};
	joinableBySite.set(siteName, cached);
	try {
		return await answer;
	} catch (error) {
		if (joinableBySite.get(siteName) === cached) {
			joinableBySite.delete(siteName);
		}

		throw error;
	}
}

function site_of(socket) {
	const name = socket.nsp.name;
	if (!sites.has(name)) {
		const site = {
			nsp: socket.nsp,
			rooms: new Map(),
			dirty: new Map(),
		};
		sites.set(name, site);
	}

	return sites.get(name);
}

// Anything but a duration is passed on as the tab sent it
function grown(duration, elapsed) {
	const isDuration = typeof duration === "number" && Number.isFinite(duration) && duration >= 0;
	if (!isDuration) {
		return duration;
	}

	return duration + elapsed;
}

// A tab sends how long it has been idle or hidden only when that changes, so the time since is added
function presence_state(entry) {
	const elapsed = Date.now() - entry.stateAt;
	const state = {
		...entry.state,
		idleFor: grown(entry.state.idleFor, elapsed),
		hiddenFor: grown(entry.state.hiddenFor, elapsed),
	};
	return {
		pid: entry.pid,
		user: entry.user,
		arrival: entry.arrival,
		n: entry.clock,
		state,
	};
}

function flush_site(site, writeBudget) {
	for (const [room, pids] of [...site.dirty]) {
		const members = site.rooms.get(room);
		const recipients = site.nsp.adapter?.rooms?.get(room)?.size ?? members?.size ?? 0;
		if (writeBudget.hasSent && recipients > writeBudget.remaining) continue;

		site.dirty.delete(room);
		const states = [...pids]
			.map((pid) => members?.get(pid))
			.filter(Boolean)
			.map(presence_state);
		if (!states.length) continue;

		writeBudget.remaining -= recipients;
		writeBudget.hasSent = true;
		site.nsp.to(room).emit("suite_collab_presence", { room, states });
	}
}

function flush_sites() {
	const writeBudget = {
		remaining: (WRITES_PER_SECOND * FLUSH_MS) / MS_PER_SECOND,
		hasSent: false,
	};
	for (const [siteName, site] of sites) {
		flush_site(site, writeBudget);
		if (!site.rooms.size && !site.dirty.size) {
			sites.delete(siteName);
		}
	}
}

// One combined message per changed room; past the write budget the rest wait for the next tick
function flush_presence() {
	flushTimer = null;
	try {
		flush_sites();
	} catch {}

	try {
		if ([...sites.values()].some((site) => site.dirty.size)) {
			schedule_flush();
		}
	} catch {}
}

function schedule_flush() {
	if (!flushTimer) {
		flushTimer = setTimeout(flush_presence, FLUSH_MS);
	}
}

// Room sets and presence share one budget per socket
function within_rate(connection) {
	const { rateWindow } = connection;
	const currentSecond = Math.floor(Date.now() / MS_PER_SECOND);
	if (rateWindow.second !== currentSecond) {
		rateWindow.second = currentSecond;
		rateWindow.count = 0;
	}

	return ++rateWindow.count <= MESSAGES_PER_SECOND;
}

function leave_rooms(connection, site, wanted) {
	const { socket, pid } = connection;
	const left = [...connection.joinedRooms].filter((room) => !wanted.has(room));
	for (const room of left) {
		connection.joinedRooms.delete(room);
		const members = site.rooms.get(room);
		members?.delete(pid);
		site.dirty.get(room)?.delete(pid);
		if (members && !members.size) {
			site.rooms.delete(room);
		}

		socket.leave(room);
	}

	for (const room of left) {
		socket.to(room).emit("suite_collab_presence_gone", { room, pid });
	}
}

function join_rooms(connection, site, wanted) {
	const { socket, pid, user, arrival } = connection;
	for (const room of wanted) {
		if (connection.joinedRooms.has(room)) continue;

		connection.joinedRooms.add(room);
		if (!site.rooms.has(room)) {
			site.rooms.set(room, new Map());
		}

		const entry = {
			pid,
			user,
			arrival,
			isGuest: connection.isGuest,
			state: null,
			hasCaret: false,
			clock: 0,
		};
		site.rooms.get(room).set(pid, entry);
		socket.join(room);
		socket.to(room).emit("suite_collab_presence_join", { room, pid, user, arrival });
	}
}

function set_rooms(connection, rooms) {
	const site = site_of(connection.socket);
	const wanted = new Set(rooms);
	if (wanted.size) {
		connection.arrival ??= ++arrivals;
	}

	leave_rooms(connection, site, wanted);
	join_rooms(connection, site, wanted);
	if (!site.rooms.size && !site.dirty.size) {
		sites.delete(connection.socket.nsp.name);
	}
}

function add_room_to_reply(reply, room, members) {
	for (const entry of members) {
		if (entry.pid === reply.pid) continue;

		reply.count++;
		if (reply.roster.length < ROSTER_MAX) {
			const member = {
				room,
				pid: entry.pid,
				user: entry.user,
				arrival: entry.arrival,
			};
			reply.roster.push(member);
		}

		if (entry.state) {
			reply.carets.push({ room, ...presence_state(entry) });
		}
	}
}

function join_reply(connection, rooms) {
	const site = site_of(connection.socket);
	const reply = {
		rooms,
		pid: connection.pid,
		arrival: connection.arrival,
		roster: [],
		count: 0,
		carets: [],
	};
	for (const room of rooms) {
		add_room_to_reply(reply, room, site.rooms.get(room)?.values() ?? []);
	}

	return reply;
}

function rooms_request_refusal(connection, rooms) {
	if (!within_rate(connection)) {
		return "rate_limited";
	}

	const roomsValid = Array.isArray(rooms) && rooms.length <= ROOMS_MAX && rooms.every(is_room);
	return roomsValid ? null : "invalid_request";
}

async function handle_rooms_request(connection, payload, acknowledge) {
	try {
		const rooms = payload?.rooms;
		const refusal = rooms_request_refusal(connection, rooms);
		if (refusal) {
			send_reply(acknowledge, { error: refusal });
			return;
		}

		const thisRequest = ++connection.roomRequests;
		const canJoin = await site_allows_join(connection.socket);
		if (thisRequest !== connection.roomRequests) return;

		if (!canJoin) {
			set_rooms(connection, []);
			send_reply(acknowledge, { error: "disabled" });
			return;
		}

		set_rooms(connection, rooms);
		send_reply(acknowledge, join_reply(connection, rooms));
	} catch {
		try {
			set_rooms(connection, []);
		} catch {
			// The rooms are left before others are told, so only the telling failed
		}
		send_reply(acknowledge, { error: "failed" });
	}
}

function named_joined_rooms(connection, rooms) {
	if (!Array.isArray(rooms)) {
		return null;
	}

	if (!rooms.length || rooms.length > ROOMS_MAX) {
		return null;
	}

	const namedRooms = new Set(rooms);
	const allJoined = [...namedRooms].every((room) => connection.joinedRooms.has(room));
	if (!allJoined) {
		return null;
	}

	return namedRooms;
}

function record_presence(connection, rooms, state) {
	const { pid } = connection;
	const site = site_of(connection.socket);
	for (const room of rooms) {
		const members = site.rooms.get(room);
		const entry = members?.get(pid);
		if (!entry) continue;

		const hasCaret = state.cursor != null && has_caret_slot(members, entry);
		entry.state = state;
		if (state.cursor != null && !hasCaret) {
			entry.state = { ...state, cursor: null };
		}

		entry.stateAt = Date.now();
		entry.hasCaret = hasCaret;
		entry.clock = connection.clock;
		if (!site.dirty.has(room)) {
			site.dirty.set(room, new Set());
		}

		site.dirty.get(room).add(pid);
	}
}

function handle_presence(connection, payload) {
	try {
		if (!within_rate(connection)) return;

		const rooms = named_joined_rooms(connection, payload?.rooms);
		if (!rooms) return;

		const state = payload?.state;
		if (!is_presence_state(state)) return;

		connection.clock++;
		record_presence(connection, rooms, state);
		schedule_flush();
	} catch {}
}

function handle_disconnect(connection) {
	try {
		connection.roomRequests++;
		set_rooms(connection, []);
	} catch {}
}

function collab_handlers(socket) {
	const user = socket.user;
	const connection = {
		socket,
		pid: PID_FLOOR + crypto.randomInt(PID_FLOOR),
		user,
		isGuest: !user || user === "Guest",
		arrival: null,
		// The pid's clock: one count across all its rooms, so a tab moving rooms is never heard going back
		clock: 0,
		joinedRooms: new Set(),
		rateWindow: { second: 0, count: 0 },
		roomRequests: 0,
	};

	socket.on("suite_collab_rooms", (payload, acknowledge) => {
		void handle_rooms_request(connection, payload, acknowledge);
	});
	socket.on("suite_collab_presence", (payload) => handle_presence(connection, payload));
	socket.on("disconnect", () => handle_disconnect(connection));
}

// Entries a site holds: one per room and one per pid, in both its dirty and member maps
function entries_held_in(site) {
	const dirtyEntries = [...site.dirty.values()].reduce((count, pids) => count + 1 + pids.size, 0);
	const memberEntries = [...site.rooms.values()].reduce(
		(count, members) => count + 1 + members.size,
		0,
	);
	return dirtyEntries + memberEntries;
}

function held_entries() {
	return [...sites.values()].reduce((sum, site) => sum + entries_held_in(site), 0);
}

module.exports = collab_handlers;
module.exports.held_entries = held_entries;
