import type { AppContext } from 'vue'

import { confirm } from '@/platform/feedback'

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
        title: 'A folder with this name exists',
        message: `This folder already has a folder named ${title}. Folders do not merge. Upload it as ${freeTitle}?`,
        confirmLabel: 'Keep both',
        cancelLabel: 'Skip',
      })
      return keep ? 'keep-both' : 'skip'
    },
    async quota({ total, free, fitting, count }) {
      if (!fitting) {
        await confirm({
          title: 'Not enough space',
          message: `These files need ${formatBytes(total)}. Only ${formatBytes(free)} is free, and none of them fit.`,
          confirmLabel: 'OK',
          cancelLabel: 'Cancel',
        })
        return 'cancel'
      }
      const fit = await confirm({
        title: 'Not enough space',
        message: `These files need ${formatBytes(total)}. Only ${formatBytes(free)} is free. ${fitting} of ${count} files fit.`,
        confirmLabel: 'Upload what fits',
        cancelLabel: 'Cancel',
      })
      return fit ? 'fit' : 'cancel'
    },
    pickFile,
  }
}
