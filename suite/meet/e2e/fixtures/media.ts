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
