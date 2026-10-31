import { describe, expect, it, vi } from 'vitest'

import { rowDropHandlers, useUploadDrop } from './drop'

/** A drag from outside the page carrying one file, as the browser sends it. */
function fileDrag(type: 'dragover' | 'drop') {
  const file = new File(['x'], 'x.txt')
  const dataTransfer = {
    types: ['Files'],
    dropEffect: 'copy',
    items: [{ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => file }],
  }
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    dataTransfer,
  })
  const stopped = vi.spyOn(event, 'stopPropagation')
  return { event: event as unknown as DragEvent, dataTransfer, stopped }
}

const row = (kind: string, role: number, state = 'Active') => ({
  name: `${kind}-${role}`,
  title: `A ${kind}`,
  root: 'root-1',
  kind,
  state,
  access: { role },
})

describe('row drop targets', () => {
  it('a folder row with UPLOAD takes the drop into itself', async () => {
    const upload = vi.fn()
    const drop = useUploadDrop(upload)
    const handlers = rowDropHandlers(drop, row('folder', 30))!

    const over = fileDrag('dragover')
    handlers.onDragover(over.event)
    expect(drop.over.value?.label).toBe('A folder')
    expect(over.stopped).toHaveBeenCalled()

    handlers.onDrop(fileDrag('drop').event)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    expect(upload.mock.calls[0]![1]).toEqual({ parent: 'folder-30', root: 'root-1' })
  })

  it('a folder row without UPLOAD refuses the drop, so the pane never gets it', async () => {
    const upload = vi.fn()
    const drop = useUploadDrop(upload)
    const handlers = rowDropHandlers(drop, row('folder', 20))!

    const over = fileDrag('dragover')
    handlers.onDragover(over.event)
    expect(over.dataTransfer.dropEffect).toBe('none')
    expect(over.stopped).toHaveBeenCalled()
    expect(drop.over.value).toBeNull()

    const dropped = fileDrag('drop')
    handlers.onDrop(dropped.event)
    expect(dropped.stopped).toHaveBeenCalled()
    await Promise.resolve()
    expect(upload).not.toHaveBeenCalled()
  })

  it('a trashed folder refuses, and a file row leaves the drop to the pane', () => {
    const drop = useUploadDrop(vi.fn())
    const trashed = fileDrag('dragover')
    rowDropHandlers(drop, row('folder', 50, 'Trashed'))!.onDragover(trashed.event)
    expect(trashed.dataTransfer.dropEffect).toBe('none')
    expect(rowDropHandlers(drop, row('file', 50))).toBeNull()
  })
})
