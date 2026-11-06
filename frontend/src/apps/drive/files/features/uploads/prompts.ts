import type { AppContext } from 'vue'

import { confirm, toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'
import { isTweakOn } from '@/platform/tweaks'

import { presentDialog } from '../dialogHost'
import { formatBytes } from './format'
import type { CollisionChoice, UploadPrompts } from './queue'

/**
 * The questions the queue asks, as dialogs in `context`. `pickFile` comes from
 * the component that owns the hidden input.
 */
export function uploadPrompts(
  context: AppContext,
  pickFile: UploadPrompts['pickFile'],
): UploadPrompts {
  return {
    async collision(input) {
      const choice = await presentDialog<CollisionChoice & { applyToAll: boolean }>(
        context,
        () => import('./UploadCollisionDialog.vue'),
        input,
        'choose',
      )
      // Closing the dialog skips the file.
      return choice ?? { action: 'skip', applyToAll: false }
    },
    async folderCollision({ title, freeTitle }) {
      const keep = await confirm({
        title: __('A folder with this name exists'),
        message: __(
          'This folder already has a folder named {0}. Folders do not merge. Upload it as {1}?',
          [title, freeTitle],
        ),
        confirmLabel: __('Keep both'),
        cancelLabel: __('Skip'),
      })
      return keep ? 'keep-both' : 'skip'
    },
    quota,
    pickFile,
  }
}

/**
 * The batch does not fit. With t30-messages on, none fitting is a toast,
 * since there is nothing to choose, and the button says what it uploads.
 */
async function quota({ total, free, fitting, count }: Parameters<UploadPrompts['quota']>[0]) {
  const messages = isTweakOn('t30-messages')
  const sizes = [formatBytes(total), formatBytes(free)]
  if (!fitting && messages) {
    toast.error(__('Not enough space to upload'), {
      description:
        count === 1
          ? __('This file needs {0}, and only {1} is free.', sizes)
          : __('These files need {0}, and only {1} is free.', sizes),
    })
    return 'cancel'
  }
  if (!fitting) {
    await confirm({
      title: __('Not enough space'),
      message: __('These files need {0}. Only {1} is free, and none of them fit.', sizes),
      confirmLabel: __('OK'),
      cancelLabel: __('Cancel'),
    })
    return 'cancel'
  }
  const upload = fitting === 1 ? __('Upload 1 file') : __('Upload {0} files', [fitting])
  const fit = await confirm({
    title: __('Not enough space'),
    message: __('These files need {0}. Only {1} is free. {2} of {3} files fit.', [
      ...sizes,
      fitting,
      count,
    ]),
    confirmLabel: messages ? upload : __('Upload what fits'),
    cancelLabel: __('Cancel'),
  })
  return fit ? 'fit' : 'cancel'
}
