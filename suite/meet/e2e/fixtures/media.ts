/**
 * Fake camera/display media for Playwright.
 *
 * Prefer MediaStreamTrackGenerator + VideoFrame when available: those produce
 * real encoded-friendly frames on headless Linux CI. canvas.captureStream alone
 * often yields live tracks with readyState stuck at 0 on GitHub runners (while
 * the same tests pass on macOS). Fall back to captureStream + requestFrame.
 *
 * Fresh stream per getUserMedia / getDisplayMedia so stopping one call does not
 * end tracks for other participants.
 */
export const STUB_MEDIA_SCRIPT = `(() => {
	window.localStorage.setItem("mediaPref.autoHideToolbar", "0");

	if (!navigator.mediaDevices) {
		Object.defineProperty(navigator, "mediaDevices", {
			value: {},
			configurable: true,
		});
	}

	function createCanvas(label) {
		const canvas = document.createElement("canvas");
		canvas.width = 640;
		canvas.height = 360;
		canvas.style.cssText =
			"position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
		document.documentElement.appendChild(canvas);
		const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
		let tick = 0;
		const draw = () => {
			if (!context) return;
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
		return { canvas, draw };
	}

	function createGeneratorStream(label) {
		if (
			typeof MediaStreamTrackGenerator === "undefined" ||
			typeof VideoFrame === "undefined"
		) {
			return null;
		}

		const { canvas, draw } = createCanvas(label);
		draw();

		const generator = new MediaStreamTrackGenerator({ kind: "video" });
		const writer = generator.writable.getWriter();
		let frameCount = 0;
		let closed = false;

		const push = async () => {
			if (closed) return;
			try {
				draw();
				const frame = new VideoFrame(canvas, {
					timestamp: frameCount * (1_000_000 / 15),
				});
				frameCount += 1;
				await writer.write(frame);
				frame.close();
			} catch {
				// Writer may close when the track ends.
			}
		};

		const intervalId = window.setInterval(() => {
			void push();
		}, 1000 / 15);
		void push();

		const stream = new MediaStream([generator]);

		const stop = () => {
			if (closed) return;
			closed = true;
			window.clearInterval(intervalId);
			try {
				void writer.close();
			} catch {}
			canvas.remove();
		};

		generator.addEventListener("ended", stop, { once: true });

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
							stop();
						},
						{ once: true },
					);
				}
			}
		} catch {}

		return stream;
	}

	function createCaptureStream(label) {
		const { canvas, draw } = createCanvas(label);
		draw();

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

	function createFakeStream(label) {
		return createGeneratorStream(label) || createCaptureStream(label);
	}

	navigator.mediaDevices.getUserMedia = async () => createFakeStream("camera");
	navigator.mediaDevices.getDisplayMedia = async () => createFakeStream("screen");

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
