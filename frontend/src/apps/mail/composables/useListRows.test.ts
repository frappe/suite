import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

import { useListRows } from '@/apps/mail/composables/useListRows'
import { CURSOR_BAR_CLASS } from '@/apps/mail/constants'
import type { Thread } from '@/apps/mail/types'

vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { group_by_date: false } } }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))

const thread = (id: string, sender: string) =>
  fromPartial<Thread>({
    thread_id: id,
    name: id,
    from_email: sender,
    received_at: '2026-11-05T10:00:00Z',
    subject: id,
    messages: [],
  })

let scope: ReturnType<typeof effectScope>
const mountRows = (openThreadID: () => string | undefined = () => undefined) =>
  scope.run(() =>
    useListRows({
      threads: () => [thread('one', 'a@example.com'), thread('two', 'b@example.com')],
      rowKey: (row) => row.thread_id,
      openThreadID,
      onOpenThreadHidden: () => {},
      container: ref(null),
    }),
  )!

// Whether the cursor's bar is drawn on the first row.
const barOnFirstRow = (rows: ReturnType<typeof mountRows>) => {
  const row = rows.navigableRows.value[0]
  return row.type === 'group' ? undefined : rows.rowClasses(row)[CURSOR_BAR_CLASS]
}

beforeEach(() => {
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

it('draws the cursor bar when the keys move the cursor, and a click takes it away', () => {
  const rows = mountRows()
  rows.focusRow(rows.navigableRows.value[0])
  expect(barOnFirstRow(rows)).toBe(true)

  // The click takes the bar away, and leaves the cursor where it is for the next key.
  window.dispatchEvent(new PointerEvent('pointerdown'))
  expect(barOnFirstRow(rows)).toBe(false)
  expect(rows.focusedRowKey.value).toBe('one')
})

// A thread opened with the mouse leaves the cursor on its row, so the keys carry on from there. Once
// its pane is closed, a bar left on that row would read as the thread still being open.
it('leaves no bar on the row of a thread opened with the mouse', () => {
  vi.useFakeTimers()
  const rows = mountRows()
  window.dispatchEvent(new PointerEvent('pointerdown'))
  rows.revealThread('one')
  vi.runAllTimers()
  expect(rows.focusedRowKey.value).toBe('one')
  expect(barOnFirstRow(rows)).toBe(false)

  // The next key carries on from that row, and draws the bar where it lands.
  rows.focusRow(rows.navigableRows.value[1])
  expect(rows.cursorRowKey.value).toBe('two')
})

// A thread opened with a click, stepped to the next one, then closed with Esc: the reader is on the
// keys, so the cursor's bar is on the row the step reached.
it('draws the bar on the row of a thread Esc closes', () => {
  vi.useFakeTimers()
  const open = ref<string | undefined>('two')
  const rows = mountRows(() => open.value)
  window.dispatchEvent(new PointerEvent('pointerdown'))
  rows.revealThread('two')
  vi.runAllTimers()

  rows.showCursor()
  open.value = 'one'
  rows.revealThread('one')
  vi.runAllTimers()
  // The open row has its own bar, and the cursor's is not drawn over it.
  expect(barOnFirstRow(rows)).toBe(false)

  open.value = undefined
  expect(barOnFirstRow(rows)).toBe(true)
})

// Opening one mail after another down the list: each click opens a row already on screen. Centring it
// moved the list under the pointer with every click; only a row out of view is brought in.
it('scrolls to an opened thread only when its row is out of view', async () => {
  vi.useFakeTimers()
  const list = document.createElement('div')
  const box = (top: number, bottom: number) => () => fromPartial<DOMRect>({ top, bottom })
  list.getBoundingClientRect = box(0, 400)
  const scrolled: string[] = []
  for (const [key, top] of [
    ['one', 100],
    ['two', 420],
  ] as const) {
    const row = document.createElement('div')
    row.dataset.rowKey = key
    row.getBoundingClientRect = box(top, top + 80)
    row.scrollIntoView = () => scrolled.push(key)
    list.append(row)
  }
  const rows = scope.run(() =>
    useListRows({
      threads: () => [thread('one', 'a@example.com'), thread('two', 'b@example.com')],
      rowKey: (row) => row.thread_id,
      openThreadID: () => undefined,
      onOpenThreadHidden: () => {},
      container: ref(list),
    }),
  )!

  rows.revealThread('one')
  await vi.runAllTimersAsync()
  rows.revealThread('two')
  await vi.runAllTimersAsync()
  expect(scrolled).toEqual(['two'])
  expect(rows.focusedRowKey.value).toBe('two')
})
