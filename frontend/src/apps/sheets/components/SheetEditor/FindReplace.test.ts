import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import FindReplace from './FindReplace.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/FormControl')),
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function mountPanel() {
  const active = ref('Sheet1')
  const cells: Record<string, Record<string, string>> = {
    Sheet1: { A1: 'apple from first tab' },
    Sheet2: { A1: 'second tab must survive', B2: 'apple from second tab' },
  }
  const edits: Array<{
    sheet: string
    before: Record<string, string>
    after: Record<string, string>
  }> = []
  let delaySearch: Promise<void> | undefined
  let delayRead: Promise<void> | undefined
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(FindReplace, {
        sheet: active.value,
        find: async (query: string, sheet = active.value) => {
          const found = Object.entries(cells[sheet]!)
            .filter(([, input]) => input.toLowerCase().includes(query.toLowerCase()))
            .map(([id, input]) => ({ id, input }))
          await delaySearch
          return found
        },
        read: async (ids: string[], sheet: string) => {
          await delayRead
          return Object.fromEntries(ids.map((id) => [id, cells[sheet]![id] ?? '']))
        },
        write: (
          before: Record<string, string>,
          after: Record<string, string>,
          sheet = active.value,
        ) => {
          edits.push({ sheet, before, after })
          Object.assign(cells[sheet]!, after)
        },
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  async function type(placeholder: string, text: string) {
    const input = root.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  function click(label: string) {
    const button = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    )
    expect(button).toBeDefined()
    button!.click()
  }
  return {
    root,
    active,
    cells,
    edits,
    type,
    click,
    delaySearch: (wait: Promise<void>) => {
      delaySearch = wait
    },
    delayRead: (wait: Promise<void>) => {
      delayRead = wait
    },
  }
}

describe('Find and replace across tabs', () => {
  it('replaces only matches on the newly selected tab and records its inputs for undo', async () => {
    const panel = mountPanel()
    await panel.type('Find', 'apple')
    await panel.type('Replace with', 'pear')
    await vi.waitFor(() => expect(panel.root.textContent).toContain('1 of 1'))
    panel.active.value = 'Sheet2'
    await nextTick()
    await vi.waitFor(() => expect(panel.root.textContent).toContain('1 of 1'))
    panel.click('Replace')
    await vi.waitFor(() => expect(panel.edits).toHaveLength(1))
    expect(panel.cells.Sheet1).toEqual({ A1: 'apple from first tab' })
    expect(panel.cells.Sheet2).toEqual({
      A1: 'second tab must survive',
      B2: 'pear from second tab',
    })
    const edit = panel.edits[0]!
    expect(edit.sheet).toBe('Sheet2')
    expect(edit.before).toEqual({ B2: 'apple from second tab' })
  })

  it('reads current cell text for replacement and the undo value after an intervening edit', async () => {
    const panel = mountPanel()
    await panel.type('Find', 'apple')
    await panel.type('Replace with', 'pear')
    await vi.waitFor(() => expect(panel.root.textContent).toContain('1 of 1'))
    panel.cells.Sheet1!.A1 = 'fresh APPLE text'
    panel.click('Replace')
    await vi.waitFor(() => expect(panel.edits).toHaveLength(1))
    expect(panel.cells.Sheet1!.A1).toBe('fresh pear text')
    expect(panel.edits[0]!.before).toEqual({ A1: 'fresh APPLE text' })
  })

  it.each(['Replace', 'All'])('discards an in-flight %s when its sheet changes', async (action) => {
    const panel = mountPanel()
    await panel.type('Find', 'apple')
    await panel.type('Replace with', 'pear')
    await vi.waitFor(() => expect(panel.root.textContent).toContain('1 of 1'))
    let release = () => {}
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    panel.delaySearch(wait)
    panel.delayRead(wait)
    panel.click(action)
    panel.active.value = 'Sheet2'
    await nextTick()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await vi.waitFor(() => expect(panel.root.textContent).toContain('1 of 1'))
    expect(panel.edits).toEqual([])
    expect(panel.cells.Sheet1!.A1).toBe('apple from first tab')
    expect(panel.cells.Sheet2!.A1).toBe('second tab must survive')
  })

  it('ignores results from the old tab when the new tab has no matches', async () => {
    const panel = mountPanel()
    panel.cells.Sheet2!.B2 = 'unrelated text'
    let release = () => {}
    panel.delaySearch(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    await panel.type('Find', 'apple')
    panel.active.value = 'Sheet2'
    await nextTick()
    release()
    await vi.waitFor(() => expect(panel.root.textContent).toContain('No matches'))
    panel.click('Replace')
    expect(panel.edits).toEqual([])
    expect(panel.cells.Sheet2).toEqual({ A1: 'second tab must survive', B2: 'unrelated text' })
  })
})
