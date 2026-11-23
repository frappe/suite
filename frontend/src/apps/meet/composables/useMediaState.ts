import { defineStore } from 'pinia'

interface ScreenShareBase {
  participantId: string
  consumerId: string
  startedAt: number
}

export interface RemoteScreenShare extends ScreenShareBase {
  source: 'remote'
  producerId: string
}

interface LocalScreenShare extends ScreenShareBase {
  source: 'local'
}

export type DisplayScreenShare = RemoteScreenShare | LocalScreenShare

export function findActiveScreenShare(
  shares: RemoteScreenShare[],
  participantId: string,
  producerId: string,
  consumerId?: string,
): RemoteScreenShare | null {
  const current = shares.find((share) => share.participantId === participantId)
  return current?.producerId === producerId && (!consumerId || current.consumerId === consumerId)
    ? current
    : null
}
interface ReplaceActiveScreenShareResult {
  shares: RemoteScreenShare[]
  replaced: RemoteScreenShare[]
}

export function replaceActiveScreenShare(
  shares: RemoteScreenShare[],
  next: RemoteScreenShare,
): ReplaceActiveScreenShareResult {
  const replaced = shares.filter(
    (share) => share.participantId === next.participantId && share.consumerId !== next.consumerId,
  )
  return {
    shares: [...shares.filter((share) => share.participantId !== next.participantId), next],
    replaced,
  }
}

interface MediaStoreState {
  isMicOn: boolean
  isCameraOn: boolean
  isScreenSharing: boolean
  localStream: MediaStream | null
  processedStream: MediaStream | null
  cameraPermissionGranted: boolean
  microphonePermissionGranted: boolean
  screenShareStream: MediaStream | null
  localScreenShareStartedAt: number
  activeScreenShareConsumers: RemoteScreenShare[]
  screenShareStreams: Record<string, MediaStream>
  localVideo: HTMLVideoElement | null
}

export const useMediaState = defineStore('meet-media', {
  state: (): MediaStoreState => ({
    isMicOn: false,
    isCameraOn: false,
    isScreenSharing: false,
    localStream: null,
    processedStream: null,
    cameraPermissionGranted: false,
    microphonePermissionGranted: false,
    screenShareStream: null,
    localScreenShareStartedAt: 0,
    activeScreenShareConsumers: [],
    screenShareStreams: {},
    localVideo: null,
  }),
  actions: {
    setMedia(mic: boolean, camera: boolean) {
      this.isMicOn = mic
      this.isCameraOn = camera
    },
  },
})

export type MediaState = ReturnType<typeof useMediaState>
