import test from "node:test";
import assert from "node:assert/strict";
import { assess } from "./assess.mjs";

test("missing scenarios cannot qualify a run", () => {
  assert.equal(assess([]).passed, false);
});

test("early progress followed by frozen video fails recovery", () => {
  const rows = (frames) =>
    Array.from({ length: 6 }, (_, i) => ({
      producerId: String(i),
      participantId: String(i),
      kind: "video",
      bytes: frames * 100,
      frames,
    }));
  const result = assess([
    {
      name: "recovered",
      bitrateBps: 1,
      samples: [
        { timestamp: 0, rows: rows(0) },
        { timestamp: 1000, rows: rows(25) },
        { timestamp: 2000, rows: rows(25) },
        { timestamp: 3000, rows: rows(25) },
        { timestamp: 4000, rows: rows(25) },
      ],
    },
  ]);
  assert.equal(result.checks.recovered, false);
  assert.equal(result.observations[0].streams[0].maximumStallMs, 3000);
});

test("counter replacement cannot produce a negative bitrate", async () => {
  const { measureStream } = await import("./measure.mjs");
  const rows = (id, bytes, frames) => [{ id, producerId: "p", bytes, frames }];
  const result = measureStream(
    [
      { rows: rows("old", 1000, 100) },
      { rows: rows("old", 1200, 110) },
      { rows: rows("new", 50, 2) },
      { rows: rows("new", 150, 7) },
    ],
    "p",
  );
  assert.deepEqual(result, { bytesDelta: 350, framesDelta: 17 });
});

test("flowing replacement consumers qualify recovery tail", () => {
	const samples = Array.from({ length: 5 }, (_, i) => ({
		timestamp: i * 1000,
		rows: [
			{
				id: i < 3 ? "old" : "new",
				producerId: "p",
				kind: "video",
				bytes: i < 3 ? 10000 + i * 100 : (i - 2) * 100,
				frames: i < 3 ? 100 + i * 25 : (i - 2) * 25,
			},
		],
	}));
	assert.equal(
		assess([{ name: "recovered", samples }], { expectedStreams: 1 }).checks
			.recovered,
		true,
	);
});
