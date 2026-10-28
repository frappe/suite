import type { Editor } from '@tiptap/core'
import { ref, watch, type Ref } from 'vue'

/**
 * A counter that moves on every transaction of the editor. The editor's state is not
 * reactive, so a computed that reads `version.value` re-reads the state. Call it in a
 * component's setup.
 */
export function useEditorVersion(editor: Ref<Editor | null | undefined>) {
  const version = ref(0)
  watch(
    editor,
    (instance, _previous, onCleanup) => {
      if (!instance) return
      const bump = () => version.value++
      instance.on('transaction', bump)
      onCleanup(() => instance.off('transaction', bump))
    },
    { immediate: true },
  )
  return version
}
