import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { useListSelection } from '@/apps/mail/composables/useListSelection'
import { useMobileSelection } from '@/apps/mail/utils/composables'

// A phone, where ticking mail turns the bottom bar into the selection bar.
vi.mock('@/apps/mail/utils/composables', async (original) => {
  const { ref } = await import('vue')
  const real = await original<typeof import('@/apps/mail/utils/composables')>()
  return { ...real, useScreenSize: () => ({ isMobile: ref(true) }) }
})

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => apps.splice(0).forEach((app) => app.unmount()))

function mountList() {
  let list!: ReturnType<typeof useListSelection>
  const app = createApp({
    setup() {
      list = useListSelection({ keys: () => ['a', 'b'], groupKeys: () => undefined })
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  apps.push(app)
  return { list, app }
}

it('stays in selection mode while one list has mail ticked, though another list leaves', async () => {
  const leaving = mountList()
  const staying = mountList()
  staying.list.selections.value = ['a']
  await nextTick()

  leaving.app.unmount()
  apps.splice(apps.indexOf(leaving.app), 1)
  await nextTick()

  expect(useMobileSelection().isMobileSelectionActive.value).toBe(true)
})
