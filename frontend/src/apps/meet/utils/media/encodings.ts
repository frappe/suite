import type { ProducerCodecOptions } from "mediasoup-client/types";

// Keep the base camera layer inexpensive so several moving faces fit alongside
// audio on a constrained receiver. The SFU selects layers per receiver.
// layer 0: low quality (120 kbps)
// layer 1: medium quality (500 kbps)
// layer 2: high quality (1800 kbps)

interface VideoEncodingLayer {
	maxBitrate: number;
	scaleResolutionDownBy?: number;
}

interface SVCEncodingLayer {
	scalabilityMode: string;
	maxBitrate: number;
}

export const videoEncodings: VideoEncodingLayer[] = [
	{ maxBitrate: 120000, scaleResolutionDownBy: 4 },
	{ maxBitrate: 500000, scaleResolutionDownBy: 2 },
	{ maxBitrate: 1800000 },
];

export const svcEncodingTemplate = (
	scalabilityMode = "L3T1",
): SVCEncodingLayer[] => [
	{
		scalabilityMode,
		maxBitrate: scalabilityMode?.startsWith("L3")
			? 1800000
			: scalabilityMode?.startsWith("L2")
				? 1200000
				: 800000,
	},
];

// no adaptive streaming for screensharing
// as we don't reduce resolution for screenshare
// and fps is handled by the hint in the browser in case of congestion control
export const screenEncodings: VideoEncodingLayer[] = [{ maxBitrate: 4000000 }];

export const videoCodecOptions: ProducerCodecOptions = {
	videoGoogleStartBitrate: 2500,
};

export const audioCodecOptions: ProducerCodecOptions = {
	// ref: https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
	opusStereo: true,
	opusDtx: true, // enable DTX to save bandwidth during silence periods
	opusFec: true, // enable FEC to improve audio quality in case of packet loss
	opusMaxAverageBitrate: 128000, // more headroom for stereo voice while staying efficient
	opusMaxPlaybackRate: 48000, // allow fullband Opus instead of forcing 24 kHz wideband
};
