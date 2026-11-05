// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App, type PropType } from 'vue'

interface DialogAction {
  label: string
  onClick?: (context: { close: () => void }) => void
}

const presentationDoc = ref<Record<string, unknown>>({})
const presentationId = ref('c1')
const saveCopy = vi.fn()

vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationDoc,
  presentationId,
  viewOnly: ref(false),
}))
vi.mock('@/apps/slides/stores/slide', () => ({ slides: ref([]) }))
vi.mock('@/apps/slides/utils/mediaUploads', async () => {
  const { isMediaNodeId, mediaNodeUrl } = await import('@/apps/slides/stores/documentMedia')
  function getAttachmentUrl(src: string) {
    if (isMediaNodeId(src)) {
      return mediaNodeUrl(src)
    }

    return src
  }

  return { getAttachmentUrl }
})
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

vi.mock('@/apps/slides/stores/offlineCopy', async (original) => ({
  ...(await original<typeof import('@/apps/slides/stores/offlineCopy')>()),
  saveOfflineCopy: saveCopy,
}))

const { toast } = await import('frappe-ui')
const { default: OfflineCopyButton } = await import('./OfflineCopyButton.vue')
const { refreshOfflineStatus } = await import('@/apps/slides/stores/offlineCopy')
const { setDocumentMedia } = await import('@/apps/slides/stores/documentMedia')
const { slides } = await import('@/apps/slides/stores/slide')

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

describe('a save that left pictures out', () => {
  let app: App

  async function saveAnswering(result: Record<string, unknown>) {
    saveCopy.mockResolvedValue(result)
    const host = document.body.appendChild(document.createElement('div'))
    app = createApp(OfflineCopyButton)
    app.mount(host)
    host.querySelector<HTMLElement>('[data-trigger]')!.click()
    await nextTick()
    ;[...document.querySelectorAll<HTMLElement>('section button')]
      .find((button) => button.textContent === 'Save copy')!
      .click()
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled())
  }

  beforeEach(() => {
    presentationDoc.value = { node: 'n1' }
    refreshOfflineStatus('c1')
    vi.mocked(toast.warning).mockClear()
  })

  afterEach(() => {
    app.unmount()
    document.body.innerHTML = ''
  })

  it("doesn't blame the connection when Drive refused them", async () => {
    await saveAnswering({ ok: false, count: 2, failed: [{ status: 'refused' }] })

    expect(toast.warning).toHaveBeenCalledWith('1 of 2 images not saved', {
      description: 'You may not have access to them.',
    })
  })

  it('suggests a retry when any of them could still come', async () => {
    await saveAnswering({
      ok: false,
      count: 3,
      failed: [{ status: 'refused' }, { status: 'network' }],
    })

    expect(toast.warning).toHaveBeenCalledWith('2 of 3 images not saved', {
      description: 'Check your connection and try again.',
    })
  })
})

describe('a saved copy of a presentation with a picture', () => {
  const MISSING =
    'Saved in this browser. Opens and presents without internet, but some images may be missing.'
  const COMPLETE = 'Saved in this browser. Opens and presents without internet.'
  let app: App
  let release: () => void

  function pictureAnswers(status: 'ready' | 'refused') {
    release = setDocumentMedia((id) => ({
      id,
      src: ref(status === 'ready' ? '/private/files/m1.png?signature=s1' : null),
      status: ref(status),
      cacheKey: ref(id),
      refresh: async () => {},
    }))
  }

  async function openDialog() {
    refreshOfflineStatus('c1')
    const host = document.body.appendChild(document.createElement('div'))
    app = createApp(OfflineCopyButton)
    app.mount(host)
    host.querySelector<HTMLElement>('[data-trigger]')!.click()
    await nextTick()
  }

  beforeEach(() => {
    presentationDoc.value = { node: 'n1' }
    slides.value = [{ elements: [{ type: 'image', src: 'media-node-1' }] }]
    localStorage.setItem(RECORD, JSON.stringify({ node: 'n1', keys: ['/private/files/m1.png'] }))
  })

  afterEach(() => {
    app.unmount()
    release()
    slides.value = []
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('says images may be missing when Drive refused one', async () => {
    pictureAnswers('refused')
    await openDialog()

    expect(document.querySelector('h2')?.textContent).toBe('Available offline')
    expect(document.querySelector('section p')?.textContent).toBe(MISSING)
  })

  it('makes no such caveat when every picture is saved', async () => {
    pictureAnswers('ready')
    await openDialog()

    expect(document.querySelector('h2')?.textContent).toBe('Available offline')
    expect(document.querySelector('section p')?.textContent).toBe(COMPLETE)
  })
})
