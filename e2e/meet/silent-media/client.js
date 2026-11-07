import { SFUMeetingManager } from "../../../frontend/src/apps/meet/utils/SFUMeetingManager";
import { SFUClient } from "../../../frontend/src/apps/meet/utils/SFUClient";
import { SocketIOSignalChannel } from "../../../frontend/src/apps/meet/utils/media/SignalChannel";
let manager, context, gain, stream, timer, ready, failure;
window.fixture = {
	configure(config) {
		document.querySelector("#start").onclick = async () => {
			try {
				context = new AudioContext();
				await context.resume();
				const oscillator = context.createOscillator();
				gain = context.createGain();
				gain.gain.value = 0.2;
				const destination = context.createMediaStreamDestination();
				oscillator.connect(gain).connect(destination);
				oscillator.start();
				stream = destination.stream;
				if (config.video) {
					const canvas = document.createElement("canvas");
					canvas.width = 320;
					canvas.height = 240;
					const drawing = canvas.getContext("2d");
					let frame = 0;
					timer = setInterval(() => {
						drawing.fillStyle = `hsl(${frame++ % 360} 80% 40%)`;
						drawing.fillRect(0, 0, 320, 240);
					}, 40);
					stream.addTrack(canvas.captureStream(25).getVideoTracks()[0]);
				}
				manager = new SFUMeetingManager(
					new SFUClient(new SocketIOSignalChannel()),
				);
				manager.initialize({
					meetingId: config.room,
					currentUser: { user_id: config.id, name: config.id },
					eventHandlers: {},
				});
				await manager.startParticipantConnection({
					prefetchedDetails: {
						authToken: config.token,
						meetingId: config.room,
						userId: config.id,
						sfuUrl: config.url,
						sfuPort: String(new URL(config.url).port),
						tokenExpiresAt: Date.now() + 600000,
						codecStrategy: "simulcast",
						e2eeRequired: false,
						isHost: false,
						isCohost: false,
					},
					prepareJoin: async () => ({
						userData: { userId: config.id, name: config.id },
						mediaState: {
							video_enabled: Boolean(config.video),
							audio_enabled: true,
						},
					}),
					waitForE2EEReady: async () => {},
					publishLocalMedia: () =>
						manager.publishInitialMedia(stream, {
							publishAudio: true,
							publishVideo: Boolean(config.video),
						}),
				});
				manager.startMediaHealthMonitoring(() => {});
				ready = true;
			} catch (error) {
				failure = String(error.stack || error);
			}
		};
	},
	demand() { return manager.setVisibleRemoteVideoParticipants(["speaker", "listener", "control"]); },
	status() {
		return { ready, failure, context: context?.state };
	},
	async sample() {
		return { at: Date.now(), sample: await manager.sampleRTCStats() };
	},
	async diagnostics() {
		return manager.getConnectionDiagnostics();
	},
	senderIdentity() {
		const producer = manager.getLocalProducer("audio");
		return { producerId: producer.id, trackId: producer.track.id };
	},
	async detach(escalate) {
		const sender = manager.getLocalProducer("audio").rtpSender;
		await sender.replaceTrack(null);
		if (escalate) {
			const replace = sender.replaceTrack.bind(sender);
			let hold = true;
			sender.replaceTrack = async (track) => {
				if (track && hold) {
					hold = false;
					return;
				}
				return replace(track);
			};
		}
	},
	silent(value) {
		gain.gain.value = value ? 0 : 0.2;
	},
	async pause(value) {
		const producer = manager.getLocalProducer("audio");
		if (value) producer.pause();
		else producer.resume();
	},
	muted(value) {
		stream.getAudioTracks()[0].enabled = !value;
	},
	async stop() {
		clearInterval(timer);
		await manager?.cleanup();
		stream?.getTracks().forEach((track) => track.stop());
		await context?.close();
	},
};
