import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import ParticipantSelector from '@/apps/calendar/components/ParticipantSelector.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

// Unit tests alias frappe-ui to a stub. The combobox is the real one here: the
// bug lived in the order it closes, clears its query and commits a pick.
vi.mock('frappe-ui', async (original) => ({
  ...(await original<object>()),
  Combobox: (
    await import('../../../../../node_modules/frappe-ui/src/components/Combobox/Combobox.vue')
  ).default,
  toast: { error: () => {} },
}))
vi.mock('@/apps/calendar/stores/user', () => ({
  userStore: () => ({ participantIdentities: { data: [] } }),
}))

const requests = vi.hoisted(() => fromPartial<string[]>([]))
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    requests.push(url)
    if (!url.includes('get_email_suggestions')) throw new Error(`Unexpected request: ${url}`)
    return new Response(
      JSON.stringify({
        message: [{ name: 'Leo Park', email: 'leo@northwind.test', user_image: '/files/leo.png' }],
      }),
    )
  }
})

// jsdom lays nothing out; reka scrolls the highlighted option into view.
Element.prototype.scrollIntoView ??= () => {}

let app: ReturnType<typeof createApp> | undefined
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  requests.length = 0
})

function mount() {
  const participants = ref<unknown[]>([])
  const element = document.createElement('div')
  document.body.append(element)
  app = createApp({
    setup: () => () =>
      h(ParticipantSelector, {
        account: 'me@northwind.test',
        modelValue: participants.value,
        'onUpdate:modelValue': (value: unknown[]) => (participants.value = value),
      }),
  })
  app.mount(element)
  return { participants, element }
}

describe('ParticipantSelector', () => {
  it('keeps the name and photo of a contact picked from the suggestions', async () => {
    // The suggestions are portalled to the body; the participant list stays in
    // the component's own element.
    const { participants, element } = mount()
    const input = document.querySelector('input')
    if (!input) throw new Error('No participant input')

    input.focus()
    input.value = 'leo'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const option = await vi.waitFor(
      () => {
        const found = Array.from(document.querySelectorAll('[role="option"]')).find((row) =>
          row.textContent?.includes('leo@northwind.test'),
        )
        if (!(found instanceof HTMLElement)) throw new Error('No suggestion yet')
        return found
      },
      { timeout: 2000 },
    )
    option.click()

    await vi.waitFor(() => expect(participants.value).toHaveLength(1))
    expect(element.textContent).toContain('Leo Park')
    const photo = element.querySelector('img[alt="Leo Park"]')
    expect(photo?.getAttribute('src')).toBe('/files/leo.png')
  })
})
