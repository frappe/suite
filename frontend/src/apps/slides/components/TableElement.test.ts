import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const markDirty = vi.hoisted(() => vi.fn())
vi.mock('@/apps/slides/stores/saving', async (actual) => ({
  ...(await actual<object>()),
  markDirty,
}))

// element.js reaches back into useTextEditor, so it has to pull it in
await import('@/apps/slides/stores/element')
const { default: TableElement } = await import('./TableElement.vue')
const { bindLiveText, noteTextEdited, noteTextReceived, setLiveSeat, unbindLiveText } =
  await import('@/apps/slides/stores/liveDeck')

const tableOf = (width: number) =>
  `<table><tbody><tr><td colwidth="${width}"><p>one</p></td></tr></tbody></table>`

const seat = {
  push: () => {},
  flush: () => {},
  undo: () => {},
  redo: () => {},
  endStep: () => {},
  bindText: () => ({ extensions: [], seeded: false }),
}

describe('a table whose column widths changed', () => {
  let app: App | undefined
  let table: { id: string; type: string; width: number; content: string }

  beforeEach(() => {
    markDirty.mockClear()
    table = reactive({ id: 't', type: 'table', width: 100, content: tableOf(100) })
    app = createApp({ render: () => h(TableElement, { element: table }) })
    app.mount(document.createElement('div'))
  })

  afterEach(() => {
    app?.unmount()
    unbindLiveText()
    setLiveSeat(null)
  })

  async function widthAfterChange() {
    table.content = tableOf(200)
    await nextTick()
    return table.width
  }

  it("writes nothing for a co-editor's widths on a table this tab has not opened", async () => {
    setLiveSeat(seat)

    expect(await widthAfterChange()).toBe(100)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it("writes nothing for a co-editor's widths on the table this tab has open", async () => {
    setLiveSeat(seat)
    bindLiveText('t', null, () => {})
    noteTextEdited()
    noteTextReceived()

    expect(await widthAfterChange()).toBe(100)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it("follows this tab's own column change in a live room", async () => {
    setLiveSeat(seat)
    bindLiveText('t', null, () => {})
    noteTextEdited()

    expect(await widthAfterChange()).toBe(200)
  })

  it('follows the columns outside a live room', async () => {
    expect(await widthAfterChange()).toBe(200)
    expect(markDirty).toHaveBeenCalled()
  })
})
