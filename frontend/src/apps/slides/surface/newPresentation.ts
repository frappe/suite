import { ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { loadTemplates, templateList } from '@/apps/slides/stores/presentation'

/** Drive opens a presentation it has just made with `?new=1`; its theme is picked once, here. */
export function useNewPresentationTheme(docname: string, editable: Ref<boolean>) {
  const route = useRoute()
  const router = useRouter()
  const open = ref(false)

  async function offer() {
    if (!('new' in route.query)) return

    const query = { ...route.query }
    delete query.new
    void router.replace({ query })
    if (!editable.value) return

    await loadTemplates()
    const isTemplate = templateList.value.some((template) => template.name === docname)
    open.value = templateList.value.length > 0 && !isTemplate
  }

  return { open, offer }
}
