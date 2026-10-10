// Live collaboration rooms. This process is shared with Meet and every other app,
// so no listener or timer here may throw or leave a promise unhandled.
const crypto = require("node:crypto");

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

// Per site: room -> Map(pid -> entry), and room -> the pids changed since the last flush
const sites = new Map();
// Per site: whether sockets may join, asked of the site at most every 30 s
const joinableBySite = new Map();
let flushTimer = null;

const is_room = (room) => typeof room === "string" && ROOM_PATTERN.test(room);

const collab_handlers = (socket) => {
	const pid = 2 ** 31 + crypto.randomInt(2 ** 31);
	const user = socket.user;
	const isGuest = !user || user === "Guest";
	const joinedRooms = new Set();
	const rateWindow = { second: 0, count: 0 };
	let roomRequests = 0;

	socket.on("suite_collab_rooms", (payload, acknowledge) => {
		try {
			if (!within_rate()) {
				send_reply(acknowledge, { error: "rate_limited" });
				return;
			}

			const rooms = payload?.rooms;
			const roomsValid = Array.isArray(rooms) && rooms.length <= ROOMS_MAX && rooms.every(is_room);
			if (!roomsValid) {
				send_reply(acknowledge, { error: "invalid_request" });
				return;
			}

			const thisRequest = ++roomRequests;
			const enterIfJoinable = (canJoin) => {
				if (thisRequest !== roomRequests) return;

				if (!canJoin) {
					set_rooms([]);
					send_reply(acknowledge, { error: "disabled" });
					return;
				}

				set_rooms(rooms);
				send_reply(acknowledge, join_reply(rooms));
			};
			site_allows_join(socket)
				.then(enterIfJoinable)
				.catch(() => send_reply(acknowledge, { error: "failed" }));
		} catch {
			send_reply(acknowledge, { error: "failed" });
		}
	});

	socket.on("suite_collab_presence", (payload) => {
		try {
			if (!within_rate()) return;

			const rooms = payload?.rooms;
			const roomCount = Array.isArray(rooms) ? rooms.length : 0;
			if (!roomCount || roomCount > ROOMS_MAX) return;

			const namedRooms = new Set(rooms);
			const allJoined = [...namedRooms].every((room) => joinedRooms.has(room));
			if (!allJoined) return;

			const state = payload?.state;
			const isObject = !!state && typeof state === "object" && !Array.isArray(state);
			if (!isObject) return;

			const stateFits =
				json_fits(state, STATE_BYTES_MAX) &&
				Buffer.byteLength(JSON.stringify(state)) <= STATE_BYTES_MAX;
			if (!stateFits) return;

			const site = site_of(socket);
			for (const room of namedRooms) {
				const members = site.rooms.get(room);
				const entry = members?.get(pid);
				if (!entry) continue;

				const hasCaret = state.cursor != null && has_caret_slot(members, entry);
				entry.state = hasCaret || state.cursor == null ? state : { ...state, cursor: null };
				entry.hasCaret = hasCaret;
				entry.updates++;
				if (!site.dirty.has(room)) {
					site.dirty.set(room, new Set());
				}
				site.dirty.get(room).add(pid);
			}
			schedule_flush();
		} catch {}
	});

	// Room sets and presence share one budget per socket
	function within_rate() {
		const now = Math.floor(Date.now() / 1000);
		if (rateWindow.second !== now) {
			rateWindow.second = now;
			rateWindow.count = 0;
		}
		return ++rateWindow.count <= MESSAGES_PER_SECOND;
	}

	socket.on("disconnect", () => {
		try {
			roomRequests++;
			set_rooms([]);
		} catch {}
	});

	function set_rooms(rooms) {
		const site = site_of(socket);
		const wanted = new Set(rooms);

		for (const room of [...joinedRooms]) {
			if (wanted.has(room)) continue;

			joinedRooms.delete(room);
			const members = site.rooms.get(room);
			members?.delete(pid);
			site.dirty.get(room)?.delete(pid);
			if (members && !members.size) {
				site.rooms.delete(room);
			}
			socket.leave(room);
			socket.to(room).emit("suite_collab_presence_gone", { room, pid });
		}

		for (const room of wanted) {
			if (joinedRooms.has(room)) continue;

			joinedRooms.add(room);
			if (!site.rooms.has(room)) {
				site.rooms.set(room, new Map());
			}
			const entry = {
				pid,
				user,
				isGuest,
				state: null,
				hasCaret: false,
				updates: 0,
			};
			site.rooms.get(room).set(pid, entry);
			socket.join(room);
			socket.to(room).emit("suite_collab_presence_join", { room, pid, user });
		}

		if (!site.rooms.size && !site.dirty.size) {
			sites.delete(socket.nsp.name);
		}
	}

	function join_reply(rooms) {
		const site = site_of(socket);
		const roster = [];
		const carets = [];
		let count = 0;
		for (const room of rooms) {
			for (const entry of site.rooms.get(room)?.values() ?? []) {
				if (entry.pid === pid) continue;

				count++;
				if (roster.length < ROSTER_MAX) {
					const member = {
						room,
						pid: entry.pid,
						user: entry.user,
					};
					roster.push(member);
				}
				if (entry.state) {
					carets.push({ room, ...presence_state(entry) });
				}
			}
		}
		return { rooms, pid, roster, count, carets };
	}
};

function has_caret_slot(members, entry) {
	if (entry.hasCaret) return true;

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

// Whether a value's JSON can fit in `budget` bytes, reading no further than that
function json_fits(value, budget) {
	const pending = [value];
	while (pending.length && budget >= 0) {
		const part = pending.pop();
		budget -= 2;
		if (typeof part === "string") {
			budget -= part.length > budget ? part.length : Buffer.byteLength(part);
		} else if (Array.isArray(part)) {
			for (let at = 0; at < part.length && budget >= 0; at++, budget--) {
				pending.push(part[at]);
			}
		} else if (part && typeof part === "object") {
			for (const key in part) {
				budget -= key.length + 4;
				pending.push(part[key]);
				if (budget < 0) break;
			}
		}
	}
	return budget >= 0;
}

function site_allows_join(socket) {
	const now = Date.now();
	const known = joinableBySite.get(socket.nsp.name);
	if (known && known.until > now) return known.answer;

	const answer = socket
		.frappe_request("/api/v2/method/suite.suite_core.content.live.joinable")
		.then((response) => response.json())
		.then((body) => body?.data === true)
		.catch(() => false);
	const cached = {
		answer,
		until: now + JOINABLE_CACHE_MS,
	};
	joinableBySite.set(socket.nsp.name, cached);
	return answer;
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

function presence_state(entry) {
	return {
		pid: entry.pid,
		user: entry.user,
		n: entry.updates,
		state: entry.state,
	};
}

function schedule_flush() {
	if (!flushTimer) {
		flushTimer = setTimeout(flush_presence, FLUSH_MS);
	}
}

// One combined message per changed room; past the write budget the rest wait for the next tick
function flush_presence() {
	flushTimer = null;
	try {
		let writeBudget = (WRITES_PER_SECOND * FLUSH_MS) / 1000;
		let sentAny = false;
		for (const [siteName, site] of sites) {
			for (const [room, pids] of [...site.dirty]) {
				const members = site.rooms.get(room);
				const recipients = site.nsp.adapter?.rooms?.get(room)?.size ?? members?.size ?? 0;
				if (sentAny && recipients > writeBudget) continue;

				site.dirty.delete(room);
				const states = [...pids]
					.map((pid) => members?.get(pid))
					.filter(Boolean)
					.map(presence_state);
				if (!states.length) continue;

				writeBudget -= recipients;
				sentAny = true;
				site.nsp.to(room).emit("suite_collab_presence", { room, states });
			}
			if (!site.rooms.size && !site.dirty.size) {
				sites.delete(siteName);
			}
		}
	} catch {}

	try {
		if ([...sites.values()].some((site) => site.dirty.size)) {
			schedule_flush();
		}
	} catch {}
}

function send_reply(acknowledge, reply) {
	if (typeof acknowledge !== "function") return;

	try {
		Promise.resolve(acknowledge(reply)).catch(() => {});
	} catch {}
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

const held_entries = () =>
	[...sites.values()].reduce((sum, site) => sum + entries_held_in(site), 0);

module.exports = collab_handlers;
module.exports.held_entries = held_entries;
