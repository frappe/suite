import type { Editor } from '@tiptap/core'
import { onBeforeUnmount, type Ref } from 'vue'

import { reportSaveError } from '@/apps/writer/composables/saveError'

const AUTOVERSION_INTERVAL_MS = 600_000

interface VersionedDocument {
  newVersion: { run(params: { data: string }): Promise<unknown> }
}

/** Every 10 minutes an edited document gets an automatic version; a collab document's server takes its own. */
export function useAutoversion(
  editor: Ref<Editor | undefined>,
  edited: Ref<boolean>,
  document: VersionedDocument,
) {
  const interval = setInterval(() => {
    void takeVersion().catch(reportSaveError)
  }, AUTOVERSION_INTERVAL_MS)
  onBeforeUnmount(() => clearInterval(interval))

  async function takeVersion() {
    if (!edited.value || !editor.value) {
      return
    }

    const html = editor.value.getHTML().trim()
    if (!html || html === '<p></p>') {
      return
    }

    await document.newVersion.run({ data: html })
  }
}
