import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { firstLayout, useNewPresentationTheme } from './newPresentation'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const store = vi.hoisted(() => ({ templates: fromPartial<{ name: string }[]>([]) }))

vi.mock('@/apps/slides/stores/presentation', async () => {
  const vue = await import('vue')
  const templateList = vue.ref<{ name: string }[]>([])
  return {
    templateList,
    loadTemplates: async () => {
      templateList.value = store.templates
    },
  }
})

const unmounts: (() => void)[] = []

afterEach(() => {
  for (const unmount of unmounts.splice(0)) {
    unmount()
  }
})

async function open(url: string, { docname = 'deck-1', canEdit = true } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node', component: { render: () => null } }],
  })
  await router.push(url)
  let theme!: ReturnType<typeof useNewPresentationTheme>
  const app = createApp(
    defineComponent({
      setup() {
        theme = useNewPresentationTheme(docname, ref(canEdit))
        return () => h('div')
      },
    }),
  )
  app.use(router)
  app.mount(document.createElement('div'))
  unmounts.push(() => app.unmount())

  await theme.offer()
  await router.isReady()
  await new Promise((resolve) => setTimeout(resolve))
  return { isShown: theme.open.value, query: router.currentRoute.value.query }
}

describe('a new presentation', () => {
  store.templates = [{ name: 'light' }, { name: 'dark' }]

  it('asks for a theme once, and the flag is gone after', async () => {
    const { isShown, query } = await open('/d/node-1?new=1&slide=2')

    expect(isShown).toBe(true)
    expect(query).toEqual({ slide: '2' })
  })

  it('is not asked without the flag', async () => {
    const { isShown } = await open('/d/node-1')

    expect(isShown).toBe(false)
  })

  it('is not asked when the caller cannot edit', async () => {
    const { isShown, query } = await open('/d/node-1?new=1', { canEdit: false })

    expect(isShown).toBe(false)
    expect(query).toEqual({})
  })

  it('is not asked of a template', async () => {
    const { isShown } = await open('/d/node-1?new=1', { docname: 'dark' })

    expect(isShown).toBe(false)
  })
})

describe('the layout a new presentation starts from', () => {
  const layouts = (count: number) => Array.from({ length: count }, (_, at) => ({ idx: at + 1 }))

  it("is a shipped theme's third, after its two covers", () => {
    expect(firstLayout({ title: 'Dark', layouts: layouts(4) })).toEqual({ idx: 3 })
    expect(firstLayout({ title: 'Light', layouts: layouts(3) })).toEqual({ idx: 3 })
  })

  it('is the first of a shipped theme too short to have its usual one', () => {
    expect(firstLayout({ title: 'Dark', layouts: layouts(2) })).toEqual({ idx: 1 })
  })

  it("is any other template's first", () => {
    expect(firstLayout({ title: 'Team', layouts: layouts(4) })).toEqual({ idx: 1 })
  })
})
