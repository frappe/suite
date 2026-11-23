import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'

import ComposeMailToolbar from '@/apps/mail/components/ComposeMailToolbar.vue'
import { translationPlugin } from '@/platform/translation'

const screen = vi.hoisted(() => ({ mobile: false }))

// A button reads out as frappe-ui's does: its label as text, its icon as nothing.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({
      props: { label: { type: String, default: '' } },
      setup:
        (props, { attrs }) =>
        () =>
          h('button', attrs, props.label),
    }),
    Dropdown: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('frappe-ui/editor', () => ({ EditorFixedMenu: { render: () => null } }))
vi.mock('@/apps/mail/components/ComposeReminderButton.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/EmojiPicker.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.({ toggle: () => undefined }),
    }),
  }
})
// The Attach menu shows only its trigger here; its items are tested on their own.
vi.mock('@/apps/mail/components/ComposeAttachMenu.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@/apps/mail/utils', () => ({ isMac: false }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: ref(screen.mobile) }),
}))
vi.mock('@/apps/mail/utils/editorMenu', () => ({ useEditorMenu: () => [] }))

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  screen.mobile = false
})

const names = () => {
  const el = document.createElement('div')
  const app = createApp(ComposeMailToolbar, { isRecipientsEmpty: false })
  app.use(translationPlugin).mount(el)
  mounted.push(app)
  return [...el.querySelectorAll('button')].map(
    (button) => button.getAttribute('aria-label') || button.textContent?.trim() || null,
  )
}

describe("the composer's toolbar", () => {
  it('names every button, the icon-only ones included', () => {
    const shown = names()
    expect(shown).not.toContain(null)
    expect(shown).toEqual(
      expect.arrayContaining(['Send', 'Schedule send', 'Insert emoji', 'Attach', 'Discard']),
    )
  })

  it('names its attach button on a phone', () => {
    screen.mobile = true
    const shown = names()
    expect(shown).not.toContain(null)
    expect(shown).toContain('Attach')
  })
})
