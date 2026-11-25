import type { ProducerCodecOptions } from 'mediasoup-client/types'

interface VideoEncodingLayer {
  maxBitrate: number
  scaleResolutionDownBy?: number
}

interface SVCEncodingLayer {
  scalabilityMode: string
  maxBitrate: number
}

export const videoEncodings: VideoEncodingLayer[] = [
  { maxBitrate: 120000, scaleResolutionDownBy: 4 },
  { maxBitrate: 500000, scaleResolutionDownBy: 2 },
  { maxBitrate: 1800000 },
]

export const svcEncodingTemplate = (scalabilityMode = 'L3T1'): SVCEncodingLayer[] => [
  {
    scalabilityMode,
    maxBitrate: scalabilityMode?.startsWith('L3')
      ? 1800000
      : scalabilityMode?.startsWith('L2')
        ? 1200000
        : 800000,
  },
]

export const screenEncodings: VideoEncodingLayer[] = [{ maxBitrate: 4000000 }]

export const videoCodecOptions: ProducerCodecOptions = {
  videoGoogleStartBitrate: 2500,
}

export const audioCodecOptions: ProducerCodecOptions = {
  opusStereo: true,
  opusDtx: true,
  opusFec: true,
  opusMaxAverageBitrate: 128000,
  opusMaxPlaybackRate: 48000,
}
