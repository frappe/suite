import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

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
const mountRows = () =>
  scope.run(() =>
    useListRows({
      threads: () => [thread('one', 'a@example.com'), thread('two', 'b@example.com')],
      rowKey: (row) => row.thread_id,
      openThreadID: () => undefined,
      onOpenThreadHidden: () => {},
      container: ref(null),
    }),
  )!

beforeEach(() => {
  scope = effectScope()
})
afterEach(() => scope.stop())

// A thread opened with the mouse leaves the cursor on its row, so the keys carry on from there. Once
// its pane is closed, a bar left on that row would read as the thread still being open.
it('draws the cursor bar while the list is walked from the keyboard, not after a click', async () => {
  const rows = mountRows()
  const barOnFirstRow = () => {
    const row = rows.navigableRows.value[0]
    return row.type === 'group' ? undefined : rows.rowClasses(row)[CURSOR_BAR_CLASS]
  }
  window.dispatchEvent(new PointerEvent('pointerdown'))
  rows.focusRow(rows.navigableRows.value[0])
  await nextTick()
  expect(rows.focusedRowKey.value).toBe('one')
  expect(barOnFirstRow()).toBe(false)

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
  expect(barOnFirstRow()).toBe(true)

  // The click takes the bar away, and leaves the cursor where it is for the next key.
  window.dispatchEvent(new PointerEvent('pointerdown'))
  expect(barOnFirstRow()).toBe(false)
  expect(rows.focusedRowKey.value).toBe('one')
})

// j, k and the arrows typed into a search box or the composer are text, not a walk down the list.
it('leaves the cursor bar off for list keys typed into a field', async () => {
  const rows = mountRows()
  const barOnFirstRow = () => {
    const row = rows.navigableRows.value[0]
    return row.type === 'group' ? undefined : rows.rowClasses(row)[CURSOR_BAR_CLASS]
  }
  rows.focusRow(rows.navigableRows.value[0])
  window.dispatchEvent(new PointerEvent('pointerdown'))
  await nextTick()

  const search = document.body.appendChild(document.createElement('input'))
  for (const key of ['j', 'k', 'ArrowDown', 'g'])
    search.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  search.remove()
  expect(barOnFirstRow()).toBe(false)
})
