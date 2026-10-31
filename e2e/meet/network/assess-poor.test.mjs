import test from "node:test";
import assert from "node:assert/strict";
import { assessPoor } from "./assess-poor.mjs";

function fixture() {
	const phase = (name, width, status) => ({
		name,
		indicator: { domStatus: status },
		samples: Array.from({ length: 6 }, (_, i) => ({
			timestamp: i * 1000,
			indicator: { domStatus: status },
			rows: [
				...["a", "b", "c", "d"].map((id) => ({
					id,
					producerId: id,
					kind: "video",
					bytes: 1000 + i * 100,
					frames: 100 + i * 20,
					width,
					height: width * 0.75,
				})),
				{
					id: "audio",
					producerId: "audio",
					kind: "audio",
					bytes: 1000 + i * 100,
					totalSamplesReceived: 48000 * (i + 1),
					concealedSamples: 0,
				},
			],
		})),
	});
	return [
		phase("baseline", 320, null),
		phase("poor", 160, "poor"),
		phase("recovered", 320, null),
	];
}

test("moving downscaled cameras, decoded audio, poor warning and recovery qualify", () =>
	assert.equal(assessPoor(fixture()).passed, true));

const failures = [
	[
		"video freezes after an initial burst",
		(windows) =>
			windows[1].samples.forEach((s, i) => {
				s.rows[1].frames = i === 0 ? 100 : 200;
			}),
	],
	[
		"audio freezes after an initial burst",
		(windows) =>
			windows[1].samples.forEach((s, i) => {
				if (i > 0)
					Object.assign(s.rows[4], {
						bytes: 2000,
						totalSamplesReceived: 96000,
					});
			}),
	],
	[
		"poor-link audio is entirely concealed",
		(windows) =>
			windows[1].samples.forEach((s) => {
				s.rows[4].concealedSamples = s.rows[4].totalSamplesReceived;
			}),
	],
	[
		"video never downscales",
		(windows) =>
			windows[1].samples.forEach((s) =>
				s.rows
					.filter((r) => r.kind === "video")
					.forEach((r) => {
						r.width = 320;
					}),
			),
	],
	[
		"warning is critical instead of poor",
		(windows) =>
			windows[1].samples.forEach((s) => {
				s.indicator.domStatus = "critical";
			}),
	],
	[
		"recovered audio is absent",
		(windows) =>
			windows[2].samples.forEach((s) => {
				s.rows = s.rows.filter((r) => r.kind !== "audio");
			}),
	],
	[
		"recovered audio stops receiving",
		(windows) =>
			windows[2].samples.forEach((s) => {
				s.rows[4].bytes = 1000;
				s.rows[4].totalSamplesReceived = 48000;
			}),
	],
	[
		"recovered audio is entirely concealed",
		(windows) =>
			windows[2].samples.forEach((s) => {
				s.rows[4].concealedSamples = s.rows[4].totalSamplesReceived;
			}),
	],
	[
		"baseline video is frozen",
		(windows) =>
			windows[0].samples.forEach((s) => {
				s.rows[0].frames = 100;
			}),
	],
	[
		"six samples cover only half a second",
		(windows) =>
			windows[1].samples.forEach((s) => {
				s.timestamp /= 10;
			}),
	],
	[
		"timestamps are missing",
		(windows) =>
			windows[1].samples.forEach((s) => {
				delete s.timestamp;
			}),
	],
	[
		"recovery has too little evidence",
		(windows) => {
			windows[2].samples = windows[2].samples.slice(-2);
		},
	],
];
for (const [name, damage] of failures)
	test(name, () => {
		const windows = fixture();
		damage(windows);
		assert.equal(assessPoor(windows).passed, false);
	});
test("missing phases cannot qualify", () =>
	assert.equal(assessPoor([]).passed, false));
