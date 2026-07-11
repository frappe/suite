/**
 * Fake camera/display media for Playwright.
 *
 * On GitHub Actions (headless Linux Chrome), off-DOM canvases driven only by
 * requestAnimationFrame often produce a live MediaStreamTrack with zero encoded
 * frames. Remote video then stays at readyState 0 forever while local preview
 * may still look "dark navy" from a single paint.
 *
 * Use setInterval + CanvasCaptureMediaStreamTrack.requestFrame() so frames keep
 * flowing under timer throttling. Create a fresh stream per getUserMedia /
 * getDisplayMedia call so stopping one clone does not end tracks for others.
 */
export const STUB_MEDIA_SCRIPT = `(() => {
	window.localStorage.setItem("mediaPref.autoHideToolbar", "0");

	if (!navigator.mediaDevices) {
		Object.defineProperty(navigator, "mediaDevices", {
			value: {},
			configurable: true,
		});
	}

	function createFakeStream(label) {
		const canvas = document.createElement("canvas");
		canvas.width = 640;
		canvas.height = 360;
		// Keep the canvas in the document so some Chromium builds keep capturing.
		canvas.style.cssText =
			"position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
		document.documentElement.appendChild(canvas);

		const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
		let tick = 0;

		const draw = () => {
			if (!context) {
				return;
			}
			// Distinct, high-contrast frame so decoders always get a real keyframe-ish delta.
			const hue = (tick * 17) % 360;
			context.fillStyle = "hsl(" + hue + " 70% 40%)";
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = "#f9fafb";
			context.font = "28px sans-serif";
			context.fillText(label, 24, 48);
			context.font = "18px monospace";
			context.fillText(String(++tick), 24, 84);
			context.fillRect(24 + (tick % 40) * 8, 120, 40, 40);
		};

		// Initial paint before capture so the first frame is never empty.
		draw();

		// Prefer manual frames via requestFrame (best under headless throttling).
		// Fall back to a fixed capture rate when requestFrame is unavailable.
		const probeStream = canvas.captureStream(0);
		const probeTrack = probeStream.getVideoTracks()[0];
		const canRequestFrame =
			probeTrack && typeof probeTrack.requestFrame === "function";

		let stream;
		let videoTrack;
		if (canRequestFrame) {
			stream = probeStream;
			videoTrack = probeTrack;
		} else {
			for (const track of probeStream.getTracks()) {
				track.stop();
			}
			stream = canvas.captureStream(15);
			videoTrack = stream.getVideoTracks()[0];
		}

		const pushFrame = () => {
			draw();
			if (videoTrack && typeof videoTrack.requestFrame === "function") {
				try {
					videoTrack.requestFrame();
				} catch {}
			}
		};

		// setInterval is far less throttled than rAF for background/headless tabs.
		const intervalId = window.setInterval(pushFrame, 1000 / 15);
		pushFrame();

		const stopCapture = () => {
			window.clearInterval(intervalId);
			canvas.remove();
		};

		for (const track of stream.getVideoTracks()) {
			track.addEventListener("ended", stopCapture, { once: true });
		}

		try {
			const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
			if (AudioContextCtor) {
				const audioContext = new AudioContextCtor();
				const oscillator = audioContext.createOscillator();
				const gainNode = audioContext.createGain();
				const destination = audioContext.createMediaStreamDestination();
				gainNode.gain.value = 0.001;
				oscillator.frequency.value = 440;
				oscillator.connect(gainNode);
				gainNode.connect(destination);
				oscillator.start();
				for (const track of destination.stream.getAudioTracks()) {
					stream.addTrack(track);
					track.addEventListener(
						"ended",
						() => {
							try {
								oscillator.stop();
								audioContext.close();
							} catch {}
						},
						{ once: true },
					);
				}
			}
		} catch {}

		return stream;
	}

	navigator.mediaDevices.getUserMedia = async () => createFakeStream("camera");
	navigator.mediaDevices.getDisplayMedia = async () => createFakeStream("screen");

	// Enumerate devices so UI paths that wait on device lists do not hang in CI.
	navigator.mediaDevices.enumerateDevices = async () => [
		{
			deviceId: "fake-camera",
			groupId: "fake-group",
			kind: "videoinput",
			label: "Fake Camera",
			toJSON() {
				return this;
			},
		},
		{
			deviceId: "fake-mic",
			groupId: "fake-group",
			kind: "audioinput",
			label: "Fake Microphone",
			toJSON() {
				return this;
			},
		},
		{
			deviceId: "fake-speaker",
			groupId: "fake-group",
			kind: "audiooutput",
			label: "Fake Speaker",
			toJSON() {
				return this;
			},
		},
	];
})();`;
