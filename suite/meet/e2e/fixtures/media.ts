/**
 * E2E media helpers.
 *
 * Camera/mic: do NOT override getUserMedia. Playwright launches Chrome with
 * --use-fake-device-for-media-stream and --use-file-for-fake-video-capture so
 * getUserMedia returns a real capture pipeline that mediasoup can encode on
 * headless Linux (canvas/MediaStreamTrackGenerator tracks often stay "live"
 * with zero decoded frames on CI).
 *
 * Screen share: Chrome has no fake display device — stub getDisplayMedia only.
 * Do not stub enumerateDevices: fake device IDs must match Chrome's so the app
 * can open the camera with deviceId constraints.
 */
export const STUB_MEDIA_SCRIPT = `(() => {
	window.localStorage.setItem("mediaPref.autoHideToolbar", "0");

	if (!navigator.mediaDevices) {
		Object.defineProperty(navigator, "mediaDevices", {
			value: {},
			configurable: true,
		});
	}

	function createFakeDisplayStream(label) {
		const canvas = document.createElement("canvas");
		canvas.width = 640;
		canvas.height = 360;
		canvas.style.cssText =
			"position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
		document.documentElement.appendChild(canvas);

		const context = canvas.getContext("2d", {
			alpha: false,
			desynchronized: true,
		});
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

		draw();

		// Prefer VideoFrame generator — better for WebRTC encode on Linux.
		if (
			typeof MediaStreamTrackGenerator !== "undefined" &&
			typeof VideoFrame !== "undefined"
		) {
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
				} catch {}
			};

			const intervalId = window.setInterval(() => {
				void push();
			}, 1000 / 15);
			void push();

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
			return new MediaStream([generator]);
		}

		const stream = canvas.captureStream(15);
		const videoTrack = stream.getVideoTracks()[0];
		const intervalId = window.setInterval(() => {
			draw();
			if (videoTrack && typeof videoTrack.requestFrame === "function") {
				try {
					videoTrack.requestFrame();
				} catch {}
			}
		}, 1000 / 15);

		videoTrack?.addEventListener(
			"ended",
			() => {
				window.clearInterval(intervalId);
				canvas.remove();
			},
			{ once: true },
		);

		return stream;
	}

	navigator.mediaDevices.getDisplayMedia = async () =>
		createFakeDisplayStream("screen");
})();`;
