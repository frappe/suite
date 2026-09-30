import { uploadQueue, type UploadIndicator } from './queue'

/**
 * What the shell's upload ring reads for the Drive area: the queue's
 * indicator, and a way to open the tracker. `apps/drive/index.ts` exports it
 * for composition to provide under the shell's `AREA_PROGRESS_KEY`.
 */
export interface DriveUploadProgress {
  readonly current: UploadIndicator | null
  open(): void
}

export function driveUploadProgress(): DriveUploadProgress {
  const queue = uploadQueue()
  return {
    get current() {
      return queue.indicator.value
    },
    open: () => queue.openTracker(),
  }
}
