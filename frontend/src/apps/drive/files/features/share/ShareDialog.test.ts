import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import ShareDialog from './ShareDialog.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const state = vi.hoisted(() => ({
  asked: fromPartial<string[]>([]),
  answer: true,
}))

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    Button: define({ setup: () => () => render('button') }),
    BottomSheet: define({ setup: () => () => null }),
    // Esc, the close button and a click outside all reach the dialog's owner as this event
    Dialog: define({
      props: { open: Boolean },
      emits: ['update:open'],
      setup: (props, { emit, slots }) => {
        return () =>
          props.open
            ? render('div', [
                render('button', {
                  'aria-label': 'Close',
                  onClick: () => emit('update:open', false),
                }),
                slots.default?.(),
              ])
            : null
      },
    }),
  }
})
vi.mock('@vueuse/core', async () => {
  const { ref: state } = await import('vue')
  return { useMediaQuery: () => state(false) }
})
vi.mock('@/api', () => ({
  api: { suite: { site: { get: {} } } },
  useQuery: () => ({ data: null }),
}))
vi.mock('@/apps/drive', () => ({ driveNodeRoute: () => ({ path: '/d/node' }) }))
vi.mock('@/platform/session', () => ({ useSession: () => ({ user: { value: { id: 'me' } } }) }))
vi.mock('@/platform/feedback', () => ({
  confirm: async ({ title }: { title: string }) => {
    state.asked.push(title)
    return state.answer
  },
}))
vi.mock('../../internal/icons', () => ({ nodeIcon: () => '', nodeIconTint: () => '' }))
vi.mock('../../internal/locations', () => ({ useLocationTitle: () => () => '' }))
vi.mock('./useShare', () => ({
  useShare: () => ({
    node: { value: null },
    loadError: { value: null },
    load: () => {},
    changed: { value: false },
  }),
}))
// The people picked, as SharePicker reports them
const picks = ref(0)
vi.mock('./ShareBody.vue', async () => {
  const { defineComponent: define, watchEffect } = await import('vue')
  return {
    default: define({
      props: { picked: Number },
      emits: ['update:picked'],
      setup: (_props, { emit }) => {
        watchEffect(() => emit('update:picked', picks.value))
        return () => null
      },
    }),
  }
})

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  state.asked = []
  state.answer = true
  picks.value = 0
})

async function tryToClose(count: number) {
  picks.value = count
  const open = ref(true)
  const host = document.body.appendChild(document.createElement('div'))
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(ShareDialog, {
          node: 'node',
          open: open.value,
          'onUpdate:open': (next: boolean) => (open.value = next),
        }),
    }),
  )
  app.mount(host)
  unmount = () => app.unmount()
  await nextTick()
  host.querySelector<HTMLElement>('[aria-label="Close"]')!.click()
  await nextTick()
  await nextTick()
  return open.value
}

describe('closing the share dialog', () => {
  it('closes right away with nobody picked', async () => {
    expect(await tryToClose(0)).toBe(false)
    expect(state.asked).toEqual([])
  })

  it('asks before discarding people picked, and closes on Discard', async () => {
    expect(await tryToClose(3)).toBe(false)
    expect(state.asked).toEqual(['Discard 3 people?'])
  })

  it('stays open when the person keeps them', async () => {
    state.answer = false
    expect(await tryToClose(1)).toBe(true)
    expect(state.asked).toEqual(['Discard 1 person?'])
  })
})
