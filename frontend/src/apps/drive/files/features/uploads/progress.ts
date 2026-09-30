import { getCurrentInstance, type AppContext } from 'vue'

import { uploadQueue, type UploadIndicator, type UploadPrompts } from './queue'

/**
 * The upload queue as the app root sees it: the indicator the shell's ring
 * reads, a way to open the tracker, and whether the tracker needs mounting.
 * `apps/drive/index.ts` exports it for composition.
 */
export interface DriveUploadProgress {
  readonly current: UploadIndicator | null
  /** The queue holds entries or is preparing folders: the tracker has something to show. */
  readonly busy: boolean
  open(): void
}

/**
 * Call it once in the app root's setup. It also answers the queue's questions
 * (collisions, quota, Resume's picker) for the whole tab, so a question asked
 * after the user leaves Drive still gets a dialog.
 */
export function driveUploadProgress(): DriveUploadProgress {
  const context = getCurrentInstance()?.appContext
  if (!context) throw new Error('driveUploadProgress() must be called in a component setup')
  const queue = uploadQueue()
  queue.setPrompts(appPrompts(context))
  return {
    get current() {
      return queue.indicator.value
    },
    get busy() {
      return queue.entries.value.length > 0 || queue.state.preparing > 0
    },
    open: () => queue.openTracker(),
  }
}

/** The dialogs load on the first question, so they stay out of the initial graph. */
function appPrompts(context: AppContext): UploadPrompts {
  const load = () => import('./prompts').then((module) => module.uploadPrompts(context, pickFileAgain))
  return {
    collision: async (input) => (await load()).collision(input),
    folderCollision: async (input) => (await load()).folderCollision(input),
    quota: async (input) => (await load()).quota(input),
    pickFile: pickFileAgain,
  }
}

/** Resume without a stored handle: the native picker, from a throwaway input. */
function pickFileAgain(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    const settle = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => settle(null), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
