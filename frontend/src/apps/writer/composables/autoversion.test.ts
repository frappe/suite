import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'

import { useAutoversion } from './autoversion'

const TEN_MINUTES = 10 * 60 * 1000

function openEditor(html: string, isEdited: boolean) {
  const editor = ref({ getHTML: () => html } as unknown as Editor)
  const edited = ref(isEdited)
  const run = vi.fn(async () => {})
  const app = createApp({
    setup() {
      useAutoversion(editor, edited, { newVersion: { run } })
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { app, run }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('automatic versions from the old editors', () => {
  it('takes a version of an edited document every ten minutes', async () => {
    const { run } = openEditor('<p>draft</p>', true)

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 1)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(TEN_MINUTES + 1)
    expect(run.mock.calls).toEqual([[{ data: '<p>draft</p>' }], [{ data: '<p>draft</p>' }]])
  })

  it('takes none of an unedited or empty document', async () => {
    const unedited = openEditor('<p>draft</p>', false)
    const empty = openEditor('<p></p>', true)

    await vi.advanceTimersByTimeAsync(TEN_MINUTES)
    expect([unedited.run.mock.calls, empty.run.mock.calls]).toEqual([[], []])
  })

  it('stops when the editor closes', async () => {
    const { app, run } = openEditor('<p>draft</p>', true)

    app.unmount()
    await vi.advanceTimersByTimeAsync(TEN_MINUTES)
    expect(run).not.toHaveBeenCalled()
  })
})
