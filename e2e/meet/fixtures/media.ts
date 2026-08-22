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
	const pendingReceiverFaults = [];
	const lifecycle = { hidden: document.hidden, online: navigator.onLine };
	Object.defineProperties(document, {
		hidden: { configurable: true, get: () => lifecycle.hidden },
		visibilityState: {
			configurable: true,
			get: () => (lifecycle.hidden ? "hidden" : "visible"),
		},
	});
	Object.defineProperty(navigator, "onLine", {
		configurable: true,
		get: () => lifecycle.online,
	});
	const injectReceiverStats = (receiver, fault) => {
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
	};
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
			this.addEventListener("track", (event) => {
				if (event.track.kind !== "video" || pendingReceiverFaults.length === 0) return;
				injectReceiverStats(event.receiver, pendingReceiverFaults.shift());
			});
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
			injectReceiverStats(receiver, fault);
			return true;
		},
		armNextVideoReceiverFault(fault) {
			pendingReceiverFaults.push(fault);
		},
		setBrowserLifecycle(next) {
			const hiddenChanged = lifecycle.hidden !== next.hidden;
			const onlineChanged = lifecycle.online !== next.online;
			lifecycle.hidden = next.hidden;
			if (hiddenChanged) document.dispatchEvent(new Event("visibilitychange"));
			lifecycle.online = next.online;
			if (onlineChanged) window.dispatchEvent(new Event(next.online ? "online" : "offline"));
		},
	};
})();`;
