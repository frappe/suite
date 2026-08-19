import type { PublishedMedia } from "./SFUMediaManager";

const MAX_PUBLICATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

type PublishMedia = (
	stream: MediaStream,
	options: { publishVideo: boolean; publishAudio: boolean },
) => Promise<PublishedMedia>;

const waitForRetry = (delay: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			window.clearTimeout(timeout);
			reject(signal?.reason);
		};
		const timeout = window.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delay);
		signal?.addEventListener("abort", onAbort, { once: true });
	});

export async function publishInitialMediaWithRetry(
	publishMedia: PublishMedia,
	stream: MediaStream,
	options: { publishVideo: boolean; publishAudio: boolean },
	signal?: AbortSignal,
): Promise<PublishedMedia> {
	const result: PublishedMedia = {};
	let publishVideo = options.publishVideo;
	let publishAudio = options.publishAudio;

	for (let attempt = 1; attempt <= MAX_PUBLICATION_ATTEMPTS; attempt++) {
		if (signal?.aborted) throw signal.reason;
		try {
			const attemptResult = await publishMedia(stream, {
				publishVideo,
				publishAudio,
			});
			Object.assign(result, attemptResult);
			if (attemptResult.videoProducer) {
				publishVideo = false;
				delete result.videoError;
			}
			if (attemptResult.audioProducer) {
				publishAudio = false;
				delete result.audioError;
			}
		} catch (error) {
			if (signal?.aborted) throw error;
			if (publishVideo) result.videoError = error;
			if (publishAudio) result.audioError = error;
		}

		if ((!publishVideo && !publishAudio) || attempt === MAX_PUBLICATION_ATTEMPTS) {
			break;
		}
		await waitForRetry(RETRY_DELAY_MS * attempt, signal);
	}

	return result;
}
