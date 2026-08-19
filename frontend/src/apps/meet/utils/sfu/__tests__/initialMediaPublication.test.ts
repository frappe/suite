import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedMedia } from "../SFUMediaManager";
import { publishInitialMediaWithRetry } from "../initialMediaPublication";

const stream = {} as MediaStream;

afterEach(() => {
	vi.useRealTimers();
});

describe("publishInitialMediaWithRetry", () => {
	it("retries only the failed media kind after partial success", async () => {
		vi.useFakeTimers();
		const videoProducer = { id: "video" };
		const audioProducer = { id: "audio" };
		const publish = vi
			.fn<() => Promise<PublishedMedia>>()
			.mockResolvedValueOnce({
				videoProducer: videoProducer as never,
				audioError: new Error("temporary audio failure"),
			})
			.mockResolvedValueOnce({ audioProducer: audioProducer as never });

		const publication = publishInitialMediaWithRetry(publish, stream, {
			publishVideo: true,
			publishAudio: true,
		});
		await vi.runAllTimersAsync();

		await expect(publication).resolves.toMatchObject({
			videoProducer,
			audioProducer,
		});
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish).toHaveBeenNthCalledWith(1, stream, {
			publishVideo: true,
			publishAudio: true,
		});
		expect(publish).toHaveBeenNthCalledWith(2, stream, {
			publishVideo: false,
			publishAudio: true,
		});
	});

	it("returns independent terminal failures after the bounded retry budget", async () => {
		vi.useFakeTimers();
		const publish = vi.fn<() => Promise<PublishedMedia>>().mockResolvedValue({
			videoError: new Error("video unavailable"),
			audioError: new Error("audio unavailable"),
		});

		const publication = publishInitialMediaWithRetry(publish, stream, {
			publishVideo: true,
			publishAudio: true,
		});
		await vi.runAllTimersAsync();

		const result = await publication;
		expect(publish).toHaveBeenCalledTimes(3);
		expect(result.videoProducer).toBeUndefined();
		expect(result.audioProducer).toBeUndefined();
		expect(result.videoError).toEqual(new Error("video unavailable"));
		expect(result.audioError).toEqual(new Error("audio unavailable"));
	});
});
