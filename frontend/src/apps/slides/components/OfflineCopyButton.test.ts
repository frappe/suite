// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App, type PropType } from 'vue'

interface DialogAction {
  label: string
  onClick?: (context: { close: () => void }) => void
}

const presentationDoc = ref<Record<string, unknown>>({})
const presentationId = ref('c1')

vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationDoc,
  presentationId,
  viewOnly: ref(false),
}))
vi.mock('@/apps/slides/stores/slide', () => ({ slides: ref([]) }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (src: string) => src }))
vi.mock('frappe-ui', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
  Button: defineComponent({
    props: { tooltip: String },
    setup: (props) => () => h('button', { 'data-trigger': '' }, props.tooltip),
  }),
  Dialog: defineComponent({
    props: {
      open: Boolean,
      title: String,
      message: String,
      actions: { type: Array as PropType<DialogAction[]>, default: () => [] },
    },
    setup: (props) => () => {
      if (!props.open) {
        return null
      }

      return h('section', [
        h('h2', props.title),
        h('p', props.message),
        ...props.actions.map((action) =>
          h('button', { onClick: () => action.onClick?.({ close: () => {} }) }, action.label),
        ),
      ])
    },
  }),
}))

const { default: OfflineCopyButton } = await import('./OfflineCopyButton.vue')
const { refreshOfflineStatus } = await import('@/apps/slides/stores/offlineCopy')

const RECORD = 'slides-offline-copy:c1'

describe('an earlier offline copy of a composite', () => {
  let app: App

  function dialogButtons() {
    return [...document.querySelectorAll<HTMLElement>('section button')]
  }

  async function openDialog() {
    const host = document.body.appendChild(document.createElement('div'))
    app = createApp(OfflineCopyButton)
    app.mount(host)
    host.querySelector<HTMLElement>('[data-trigger]')!.click()
    await nextTick()
  }

  beforeEach(() => {
    presentationDoc.value = { node: 'n1', is_composite: 1 }
    localStorage.setItem(RECORD, JSON.stringify({ node: 'n1', keys: [] }))
    vi.stubGlobal('caches', { open: async () => ({ delete: async () => true }) })
    refreshOfflineStatus('c1')
  })

  afterEach(() => {
    app.unmount()
    localStorage.clear()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it("isn't called available, and can't be saved again", async () => {
    await openDialog()

    expect(document.body.textContent).toContain("Offline copy can't open")
    expect(document.body.textContent).not.toContain('Available offline')
    const labels = dialogButtons().map((button) => button.textContent)
    expect(labels).not.toContain('Save copy')
    expect(labels).not.toContain('Update copy')
  })

  it('can be removed', async () => {
    await openDialog()

    dialogButtons()
      .find((button) => button.textContent === 'Remove copy')!
      .click()

    await vi.waitFor(() => expect(localStorage.getItem(RECORD)).toBeNull())
  })
})
