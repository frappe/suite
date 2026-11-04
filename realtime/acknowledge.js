// Answer a client's acknowledgement callback, if it sent one, without letting it throw
function send_reply(acknowledge, reply) {
	if (typeof acknowledge !== "function") return;

	try {
		Promise.resolve(acknowledge(reply)).catch(() => {});
	} catch {}
}

module.exports = send_reply;
