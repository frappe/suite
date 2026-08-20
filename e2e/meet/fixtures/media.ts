/**
 * Camera/mic: Chrome --use-fake-device-for-media-stream (see playwright.config).
 * Screen share: Chrome has no fake display device — stub getDisplayMedia only.
 */
export const STUB_MEDIA_SCRIPT = `(() => {
	window.localStorage.setItem("mediaPref.autoHideToolbar", "0");

	if (!navigator.mediaDevices) {
		Object.defineProperty(navigator, "mediaDevices", {
			value: {},
			configurable: true,
		});
	}

	navigator.mediaDevices.getDisplayMedia = async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 640;
		canvas.height = 360;
		const context = canvas.getContext("2d");
		let tick = 0;
		const draw = () => {
			if (!context) return;
			context.fillStyle = "#111827";
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = "#f9fafb";
			context.font = "24px sans-serif";
			context.fillText("screen", 24, 48);
			context.fillText(String(++tick), 24, 80);
		};
		draw();
		const stream = canvas.captureStream(12);
		const intervalId = window.setInterval(draw, 1000 / 12);
		for (const track of stream.getVideoTracks()) {
			track.addEventListener(
				"ended",
				() => window.clearInterval(intervalId),
				{ once: true },
			);
		}
		return stream;
	};
})();`;

export const MEDIA_FAULT_SCRIPT = `(() => {
	const localTracks = { audio: [], video: [] };
	const peerConnections = [];
	const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
		navigator.mediaDevices,
	);
	if (originalGetUserMedia) {
		navigator.mediaDevices.getUserMedia = async (...args) => {
			const stream = await originalGetUserMedia(...args);
			for (const track of stream.getTracks()) localTracks[track.kind]?.push(track);
			return stream;
		};
	}

	const NativePeerConnection = window.RTCPeerConnection;
	window.RTCPeerConnection = class extends NativePeerConnection {
		constructor(...args) {
			super(...args);
			peerConnections.push(this);
		}
	};

	window.__meetMediaFaults = {
		latestLocalTrackId(kind) {
			return [...localTracks[kind]].reverse().find((track) => track.readyState === "live")?.id ?? null;
		},
		stopLatestLocalTrack(kind) {
			const track = [...localTracks[kind]].reverse().find((item) => item.readyState === "live");
			if (!track) return null;
			track.stop();
			track.dispatchEvent(new Event("ended"));
			return track.id;
		},
		async injectReceiverStats(trackId, fault) {
			const receiver = peerConnections
				.flatMap((connection) => connection.getReceivers())
				.find((item) => item.track?.id === trackId);
			if (!receiver) return false;
			const originalGetStats = receiver.getStats.bind(receiver);
			receiver.getStats = async () => {
				const report = await originalGetStats();
				const injected = new Map();
				report.forEach((value, key) => {
					if (value.type !== "inbound-rtp" || value.kind !== "video") {
						injected.set(key, value);
						return;
					}
					injected.set(key, {
						...value,
						...(fault === "zero-bytes" ? { bytesReceived: 0 } : {}),
						...(fault === "decode-stall" ? { framesDecoded: 0 } : {}),
					});
				});
				return injected;
			};
			return true;
		},
	};
})();`;
