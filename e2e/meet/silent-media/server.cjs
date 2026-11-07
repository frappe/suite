// Isolated test process only: no production endpoint exposes native pause.
require("../../../suite/meet/sfu-server/node_modules/ts-node/register");
const {
	ConsumerManager,
} = require("../../../suite/meet/sfu-server/src/mediasoup/ConsumerManager.ts");
const managers = new Set();
const blocked = new Set();
function block(consumer) {
	consumer.resume = async () => {};
	return consumer.pause();
}
const create = ConsumerManager.prototype.createConsumer;
ConsumerManager.prototype.createConsumer = async function (...args) {
	managers.add(this);
	const result = await create.apply(this, args);
	if (blocked.has(args[0].id))
		await block(this.getConsumerData(result.id).consumer);
	return result;
};
process.on("message", async (message) => {
	try {
		for (const manager of managers) {
			const entry = manager.getConsumerData(message.id);
			if (!entry) continue;
			if (message.transport) {
				blocked.add(entry.transportId);
				for (const candidate of manager.getConsumersByPeer(
					entry.roomId,
					entry.peerId,
				)) {
					await block(candidate.consumer);
				}
			} else await entry.consumer.pause();
			process.send({ success: true, id: message.id });
			return;
		}
		throw Error("Native consumer not found");
	} catch (error) {
		process.send({ error: String(error) });
	}
});
require("../../../suite/meet/sfu-server/src/server.ts");
