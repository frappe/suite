// Live collaboration rooms. This process is shared with Meet and every other app,
// so no listener or timer here may throw or leave a promise unhandled.
const crypto = require("node:crypto");

const ROOM = /^sc:[A-Za-z0-9_-]{32}$/;
const ROOMS_MAX = 8;
const STATE_MAX = 2048;
const FLUSH_MS = 100;
const RATE_PER_SECOND = 50;
const CARETS_MAX = 50;
const GUEST_CARETS_MAX = 10;
const ROSTER_MAX = 50;
const WRITES_PER_SECOND = 20000;
const JOINABLE_MS = 30000;

// Per site: room -> Map(pid -> entry), and room -> the pids changed since the last flush
const sites = new Map();
// Per site: whether sockets may join, asked of the site at most every 30 s
const allowed = new Map();
let timer = null;

const collab_handlers = (socket) => {
	const pid = 2 ** 31 + crypto.randomInt(2 ** 31);
	const user = socket.user;
	const guest = !user || user === "Guest";
	const joined = new Set();
	const rate = { second: 0, count: 0 };
	let asked = 0;

	socket.on("suite_collab_rooms", (payload, acknowledge) => {
		try {
			if (!spend()) {
				answer(acknowledge, { error: "rate_limited" });
				return;
			}
			const rooms = payload?.rooms;
			if (
				!Array.isArray(rooms) ||
				rooms.length > ROOMS_MAX ||
				!rooms.every((room) => typeof room === "string" && ROOM.test(room))
			) {
				answer(acknowledge, { error: "invalid_request" });
				return;
			}
			const ask = ++asked;
			joinable(socket)
				.then((allowed) => {
					if (ask !== asked) return;
					if (!allowed) {
						enter([]);
						answer(acknowledge, { error: "disabled" });
						return;
					}
					enter(rooms);
					answer(acknowledge, ack(rooms));
				})
				.catch(() => answer(acknowledge, { error: "failed" }));
		} catch {
			answer(acknowledge, { error: "failed" });
		}
	});

	socket.on("suite_collab_presence", (payload) => {
		try {
			if (!spend()) return;
			const rooms = payload?.rooms;
			if (!Array.isArray(rooms) || !rooms.length || rooms.length > ROOMS_MAX) return;
			const named = new Set(rooms);
			if (![...named].every((room) => joined.has(room))) return;
			const state = payload?.state;
			if (!state || typeof state !== "object" || Array.isArray(state)) return;
			if (!fits(state, STATE_MAX) || Buffer.byteLength(JSON.stringify(state)) > STATE_MAX) return;
			const site = site_of(socket);
			for (const room of named) {
				const entry = site.rooms.get(room)?.get(pid);
				if (!entry) continue;
				const caret = state.cursor != null && has_caret_slot(site.rooms.get(room), entry);
				entry.state = caret || state.cursor == null ? state : { ...state, cursor: null };
				entry.caret = caret;
				entry.n++;
				if (!site.dirty.has(room)) site.dirty.set(room, new Set());
				site.dirty.get(room).add(pid);
			}
			schedule();
		} catch {}
	});

	// Room sets and presence share one budget per socket
	function spend() {
		const now = Math.floor(Date.now() / 1000);
		if (rate.second !== now) Object.assign(rate, { second: now, count: 0 });
		return ++rate.count <= RATE_PER_SECOND;
	}

	socket.on("disconnect", () => {
		try {
			asked++;
			enter([]);
		} catch {}
	});

	function enter(rooms) {
		const site = site_of(socket);
		const wanted = new Set(rooms);
		for (const room of [...joined]) {
			if (wanted.has(room)) continue;
			joined.delete(room);
			const members = site.rooms.get(room);
			members?.delete(pid);
			site.dirty.get(room)?.delete(pid);
			if (members && !members.size) site.rooms.delete(room);
			socket.leave(room);
			socket.to(room).emit("suite_collab_presence_gone", { room, pid });
		}
		for (const room of wanted) {
			if (joined.has(room)) continue;
			joined.add(room);
			if (!site.rooms.has(room)) site.rooms.set(room, new Map());
			site.rooms.get(room).set(pid, { pid, user, guest, state: null, caret: false, n: 0 });
			socket.join(room);
			socket.to(room).emit("suite_collab_presence_join", { room, pid, user });
		}
		if (!site.rooms.size && !site.dirty.size) sites.delete(socket.nsp.name);
	}

	function ack(rooms) {
		const site = site_of(socket);
		const roster = [];
		const carets = [];
		let count = 0;
		for (const room of rooms) {
			for (const entry of site.rooms.get(room)?.values() ?? []) {
				if (entry.pid === pid) continue;
				count++;
				if (roster.length < ROSTER_MAX) roster.push({ room, pid: entry.pid, user: entry.user });
				if (entry.state) carets.push({ room, ...sent(entry) });
			}
		}
		return { rooms, pid, roster, count, carets };
	}
};

function has_caret_slot(members, entry) {
	if (entry.caret) return true;
	let carets = 0;
	let guests = 0;
	for (const other of members.values()) {
		if (!other.caret) continue;
		carets++;
		if (other.guest) guests++;
	}
	return carets < CARETS_MAX && (!entry.guest || guests < GUEST_CARETS_MAX);
}

// Whether a value's JSON can fit in `budget` bytes, reading no further than that
function fits(value, budget) {
	const pending = [value];
	while (pending.length && budget >= 0) {
		const item = pending.pop();
		budget -= 2;
		if (typeof item === "string") budget -= item.length > budget ? item.length : Buffer.byteLength(item);
		else if (Array.isArray(item)) {
			for (let at = 0; at < item.length && budget >= 0; at++, budget--) pending.push(item[at]);
		} else if (item && typeof item === "object") {
			for (const key in item) {
				budget -= key.length + 4;
				pending.push(item[key]);
				if (budget < 0) break;
			}
		}
	}
	return budget >= 0;
}

function joinable(socket) {
	const now = Date.now();
	const known = allowed.get(socket.nsp.name);
	if (known && known.until > now) return known.answer;
	const answer = socket
		.frappe_request("/api/v2/method/suite.suite_core.collab.live.joinable", {}, { method: "POST" })
		.then((response) => response.json())
		.then((body) => body?.data === true)
		.catch(() => false);
	allowed.set(socket.nsp.name, { answer, until: now + JOINABLE_MS });
	return answer;
}

function site_of(socket) {
	const name = socket.nsp.name;
	if (!sites.has(name)) sites.set(name, { nsp: socket.nsp, rooms: new Map(), dirty: new Map() });
	return sites.get(name);
}

function sent(entry) {
	return { pid: entry.pid, user: entry.user, n: entry.n, state: entry.state };
}

function schedule() {
	if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

// One combined message per changed room; past the write budget the rest wait for the next tick
function flush() {
	timer = null;
	try {
		let budget = (WRITES_PER_SECOND * FLUSH_MS) / 1000;
		let flushed = false;
		for (const [name, site] of sites) {
			for (const [room, pids] of [...site.dirty]) {
				const members = site.rooms.get(room);
				const writes = site.nsp.adapter?.rooms?.get(room)?.size ?? members?.size ?? 0;
				if (flushed && writes > budget) continue;
				site.dirty.delete(room);
				const states = [...pids].map((pid) => members?.get(pid)).filter(Boolean).map(sent);
				if (!states.length) continue;
				budget -= writes;
				flushed = true;
				site.nsp.to(room).emit("suite_collab_presence", { room, states });
			}
			if (!site.rooms.size && !site.dirty.size) sites.delete(name);
		}
	} catch {}
	try {
		if ([...sites.values()].some((site) => site.dirty.size)) schedule();
	} catch {}
}

function answer(acknowledge, value) {
	if (typeof acknowledge !== "function") return;
	try {
		Promise.resolve(acknowledge(value)).catch(() => {});
	} catch {}
}

const held = () =>
	[...sites.values()].reduce(
		(sum, site) =>
			sum +
			[...site.dirty.values()].reduce((count, pids) => count + 1 + pids.size, 0) +
			[...site.rooms.values()].reduce((count, members) => count + 1 + members.size, 0),
		0,
	);

module.exports = collab_handlers;
module.exports.held = held;
