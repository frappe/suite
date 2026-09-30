import { readonly, ref } from 'vue'

import type { UploadTarget } from './queue'
import { captureDrop, dragHasFiles, type UploadSelection } from './sources'

/** A place that takes dropped files, and the name the overlay shows for it. */
export interface DropZone {
  key: string
  label: string
  target: UploadTarget
}

export interface DropHandlers {
  onDragover(event: DragEvent): void
  onDragleave(event: DragEvent): void
  onDrop(event: DragEvent): void
}

/**
 * Drop targets for files from outside the page (spec §6.7): the folder pane
 * and each folder row. A zone whose `resolve` gives `null` refuses the drop,
 * as saved views, search and folders without UPLOAD do. A refused drop is
 * still caught, so the browser never opens the file in place of the app.
 */
export function useUploadDrop(upload: (selection: UploadSelection, target: UploadTarget) => unknown) {
  const over = ref<DropZone | null>(null)

  function zone(resolve: () => DropZone | null): DropHandlers {
    return {
      onDragover(event) {
        if (!dragHasFiles(event)) return
        // A row sits inside the pane; the innermost zone wins.
        event.stopPropagation()
        event.preventDefault()
        const found = resolve()
        if (event.dataTransfer) event.dataTransfer.dropEffect = found ? 'copy' : 'none'
        if (over.value?.key !== found?.key) over.value = found
      },
      onDragleave(event) {
        const left = event.currentTarget as Node | null
        const entered = event.relatedTarget as Node | null
        if (left && entered && left.contains(entered)) return
        const found = resolve()
        if (over.value && over.value.key === found?.key) over.value = null
      },
      onDrop(event) {
        if (!dragHasFiles(event)) return
        event.stopPropagation()
        event.preventDefault()
        over.value = null
        const found = resolve()
        if (!found || !event.dataTransfer) return
        // The transfer empties when this handler returns; read it now.
        const captured = captureDrop(event.dataTransfer)
        if (!captured.hasFiles) return
        void captured.read().then((selection) => upload(selection, found.target))
      },
    }
  }

  return { over: readonly(over), zone }
}
