import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, effectScope, h, nextTick, ref } from 'vue'

import { railHidden, useHideRail } from '@/platform/rail'

const Page = defineComponent({
  setup() {
    useHideRail()
    return () => h('div')
  },
})

describe('useHideRail', () => {
  it('hides the rail while a page asking for it is mounted', () => {
    const app = createApp(Page)
    app.mount(document.createElement('div'))

    expect(railHidden.value).toBe(true)

    app.unmount()

    expect(railHidden.value).toBe(false)
  })

  it('keeps the rail hidden while another request is still open', () => {
    const first = effectScope()
    const second = effectScope()
    first.run(() => useHideRail())
    second.run(() => useHideRail())

    first.stop()

    expect(railHidden.value).toBe(true)

    second.stop()

    expect(railHidden.value).toBe(false)
  })

  it('follows its condition', async () => {
    const editing = ref(false)
    const scope = effectScope()
    scope.run(() => useHideRail(editing))

    expect(railHidden.value).toBe(false)

    editing.value = true
    await nextTick()

    expect(railHidden.value).toBe(true)

    scope.stop()

    expect(railHidden.value).toBe(false)
  })
})
