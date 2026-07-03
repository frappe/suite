// layers for simulcast video streaming (adaptive streaming)
// layer 0: low quality (300 kbps)
// layer 1: medium quality (700 kbps)
// layer 2: high quality (1800 kbps)

interface VideoEncodingLayer {
	maxBitrate: number;
	scaleResolutionDownBy?: number;
}

interface SVCEncodingLayer {
	scalabilityMode: string;
	maxBitrate: number;
}

interface CodecOptions {
	videoGoogleStartBitrate?: number;
	opusStereo?: number;
	opusDtx?: number;
	opusFec?: number;
	opusMaxAverageBitrate?: number;
	opusMaxPlaybackRate?: number;
}

export const videoEncodings: VideoEncodingLayer[] = [
	{ maxBitrate: 300000, scaleResolutionDownBy: 2 },
	{ maxBitrate: 700000, scaleResolutionDownBy: 1 },
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

export const videoCodecOptions: CodecOptions = {
	videoGoogleStartBitrate: 2500,
};

export const audioCodecOptions: CodecOptions = {
	// ref: https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
	opusStereo: 1,
	opusDtx: 1, // enable DTX to save bandwidth during silence periods
	opusFec: 1, // enable FEC to improve audio quality in case of packet loss
	opusMaxAverageBitrate: 128000, // more headroom for stereo voice while staying efficient
	opusMaxPlaybackRate: 48000, // allow fullband Opus instead of forcing 24 kHz wideband
};
