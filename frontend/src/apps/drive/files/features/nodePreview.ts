import { computed, reactive, ref, type ComputedRef } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'

export type PreviewNode = Pick<DriveNode, 'name' | 'kind' | 'content_doctype' | 'preview'>

/**
 * What Drive remembers about thumbnails, shared by every card on every page.
 *
 * Preview URLs are signed, so a refetch brings a new URL for the same file.
 * - `failed` is per URL: a new URL gets a fresh try, a failed one stays failed.
 * - `loaded` holds the last URL that loaded for each file. A card mounted again
 *   for that URL, as after going Back, shows the image at once from the
 *   browser's cache instead of starting as its type icon.
 * - `retried` holds the files that already asked for a fresh URL. A file leaves
 *   it when a preview loads, so one whose previews keep failing asks only once.
 */
export interface PreviewMemory {
  loaded: Map<string, string>
  failed: Set<string>
  retried: Set<string>
}

export function createPreviewMemory(): PreviewMemory {
  return { loaded: reactive(new Map()), failed: reactive(new Set()), retried: new Set() }
}

const sharedMemory = createPreviewMemory()

export interface NodePreview {
  /** The thumbnail to load, or `undefined` when the card keeps its type icon. */
  url: ComputedRef<string | undefined>
  /** True once the thumbnail can be shown in place of the icon. */
  shown: ComputedRef<boolean>
  loaded(): void
  /** Records a failed thumbnail. True when the caller should refetch for a fresh URL. */
  failed(): boolean
}

/** One card's thumbnail. Call it once per card, in the card's setup. */
export function useNodePreview(node: () => PreviewNode, memory: PreviewMemory = sharedMemory): NodePreview {
  // This card has shown an image. When a refetch changes the URL, the browser
  // keeps painting the old image while the new one loads, so the card does not
  // blink back to its type icon.
  const painted = ref(false)
  const url = computed(() => {
    const current = node()
    // A slide thumbnail doesn't read well at card size, so presentations keep their icon.
    if (current.kind === 'document' && current.content_doctype === 'Presentation') return undefined
    const candidate = current.preview?.url
    return candidate && !memory.failed.has(candidate) ? candidate : undefined
  })
  const shown = computed(() => {
    const current = url.value
    return current !== undefined && (painted.value || memory.loaded.get(node().name) === current)
  })
  return {
    url,
    shown,
    loaded() {
      const { name } = node()
      if (url.value) memory.loaded.set(name, url.value)
      memory.retried.delete(name)
      painted.value = true
    },
    failed() {
      const { name, preview } = node()
      if (preview?.url) memory.failed.add(preview.url)
      // A fresh URL starts as a plain card again, not as an empty image frame.
      painted.value = false
      memory.loaded.delete(name)
      if (memory.retried.has(name)) return false
      memory.retried.add(name)
      return true
    },
  }
}
