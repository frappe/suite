import { ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { loadTemplates, templateList } from '@/apps/slides/stores/presentation'

// Light and Dark open with two cover layouts, so a new presentation starts from the third,
// as the server's `first_layout` does
const SYSTEM_TEMPLATES = new Set(['Light', 'Dark'])
const SYSTEM_TEMPLATE_FIRST_LAYOUT = 2

/** The layout a new presentation taking this template starts from. */
export function firstLayout<Layout>(template: { title: string; layouts: Layout[] }): Layout {
  const { title, layouts } = template
  const isSystem = SYSTEM_TEMPLATES.has(title) && layouts.length > SYSTEM_TEMPLATE_FIRST_LAYOUT
  return layouts[isSystem ? SYSTEM_TEMPLATE_FIRST_LAYOUT : 0]
}

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
