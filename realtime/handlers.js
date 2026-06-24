const meet_handlers = (socket) => {
	socket.on("ping", () => {
		socket.emit("pong");
	});

	// guest specific rooms
	socket.on("guest_subscribe", async (guest_id) => {
		if (!guest_id || typeof guest_id !== "string") {
			return;
		}

		if (!guest_id.startsWith("guest_") || guest_id.length < 10) {
			return;
		}

		// session validation for guest
		socket
			.frappe_request("/api/method/suite.meet.api.meeting.validate_guest_session", {
				guest_id: guest_id,
			})
			.then((res) => res.json())
			.then(({ message }) => {
				if (!message.valid) {
					return;
				}
				const room = guest_room(guest_id);
				socket.join(room);
			});
	});

	socket.on("guest_unsubscribe", (guest_id) => {
		if (!guest_id) return;

		const room = guest_room(guest_id);
		socket.leave(room);
	});
};

guest_room = (guest_id) => `guest:${guest_id}`;

module.exports = meet_handlers;
