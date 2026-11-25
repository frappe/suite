import { translate as __ } from '@/platform/translation'

export interface CaptureOptions {
  video_enabled: boolean
  transcription_enabled: boolean
  language: 'en'
}

export const defaultCaptureOptions = (): CaptureOptions => ({
  video_enabled: true,
  transcription_enabled: false,
  language: 'en',
})

export type TranscriptionCaptureState = 'capturing' | 'complete' | 'partial' | 'failed'
type CaptureActivity = Partial<CaptureOptions> & {
  transcription_capture_state?: TranscriptionCaptureState | null
  video_capture_state?: 'starting' | 'capturing' | 'complete' | 'failed' | null
}

export function captureLabel(options?: CaptureActivity | null) {
  if (!options?.transcription_enabled) return __('Recording')
  return options.video_enabled === false ? __('Transcription') : __('Recording and transcription')
}

function captureActivity(options?: CaptureActivity | null) {
  const video =
    options?.video_enabled !== false &&
    (!options?.video_capture_state || options.video_capture_state === 'capturing')
  const transcription =
    options?.transcription_enabled &&
    (!options.transcription_capture_state || options.transcription_capture_state === 'capturing')
  if (video && transcription) return 'both'
  if (video) return 'video'
  if (transcription) return 'transcription'
  return null
}

export function captureActivityLabel(options?: CaptureActivity | null) {
  switch (captureActivity(options)) {
    case 'both':
      return __('Recording and transcription')
    case 'video':
      return __('Recording')
    case 'transcription':
      return __('Transcription')
    default:
      return null
  }
}

export function captureNotice(options?: CaptureActivity | null) {
  switch (captureActivity(options)) {
    case 'both':
      return __('This meeting is being recorded and transcribed')
    case 'transcription':
      return __('This meeting is being transcribed')
    case 'video':
      return options?.transcription_enabled
        ? __('This meeting is being recorded. Transcription capture has ended.')
        : __('This meeting is being recorded')
    default:
      return __('Transcription capture has ended')
  }
}
