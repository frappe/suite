const suite_handlers = (socket) => {
	socket.on("ping", () => {
		socket.emit("pong");
	});

	// guest specific rooms
	socket.on("guest_subscribe", async (payload, untrustedAcknowledge) => {
		const acknowledge = safe_acknowledge(untrustedAcknowledge);
		try {
			const validation = await validate_guest(socket, payload);
			if (!validation.ok) {
				acknowledge(validation);
				return;
			}
			await socket.join(guest_room(payload.guest_id));
			const currentValidation = await validate_guest(socket, payload);
			if (!currentValidation.ok) {
				await socket.leave(guest_room(payload.guest_id));
				acknowledge(currentValidation);
				return;
			}
			acknowledge(currentValidation);
		} catch {
			acknowledge({ ok: false, error: "validation_failed" });
		}
	});

	socket.on("guest_unsubscribe", async (payload, untrustedAcknowledge) => {
		const acknowledge = safe_acknowledge(untrustedAcknowledge);
		try {
			const validation = await validate_guest(socket, payload);
			if (!validation.ok && !validation.status) {
				acknowledge(validation);
				return;
			}
			await socket.leave(guest_room(payload.guest_id));
			acknowledge({
				ok: true,
				...(validation.status && { status: validation.status }),
			});
		} catch {
			acknowledge({ ok: false, error: "validation_failed" });
		}
	});
};

const GUEST_STATUSES = new Set([
	"pending",
	"admitted",
	"expired",
	"rejected",
	"banned",
]);

const safe_acknowledge = (acknowledge) => (value) => {
	if (typeof acknowledge !== "function") return;
	try {
		Promise.resolve(acknowledge(value)).catch(() => {});
	} catch {}
};

const validate_guest = async (socket, payload) => {
	if (
		!payload ||
		typeof payload !== "object" ||
		typeof payload.guest_id !== "string" ||
		!payload.guest_id.startsWith("guest_") ||
		payload.guest_id.length < 10 ||
		typeof payload.meeting_id !== "string" ||
		!payload.meeting_id ||
		typeof payload.guest_session_token !== "string" ||
		!payload.guest_session_token
	) {
		return { ok: false, error: "invalid_request" };
	}

	try {
		const body = new URLSearchParams(payload);
		const response = await socket.frappe_request(
			"/api/method/suite.meet.api.meeting.validate_guest_session",
			{},
			{ method: "POST", body },
		);
		const data = await response.json();
		const status = GUEST_STATUSES.has(data?.message?.status)
			? data.message.status
			: undefined;
		return data?.message?.valid === true
			? { ok: true, ...(status && { status }) }
			: { ok: false, error: "unauthorized", ...(status && { status }) };
	} catch {
		return { ok: false, error: "validation_failed" };
	}
};

const guest_room = (guest_id) => `guest:${guest_id}`;

module.exports = suite_handlers;
