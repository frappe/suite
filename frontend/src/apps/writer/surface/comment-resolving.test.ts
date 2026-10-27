import { describe, expect, it, vi } from 'vitest'

import { toasts } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  labelled,
  openRows,
  rowButton,
  rows,
  settled,
  showList,
} from './comment-list-fixtures'

vi.mock('@/platform/session', async () => {
  const { fakeSession } = await import('./comment-list-fakes')
  return fakeSession()
})

vi.mock('@/apps/writer/composables/useUsers', async () => {
  const { fakeUsers } = await import('./comment-list-fakes')
  return fakeUsers()
})

vi.mock('@/platform/feedback', async () => {
  const { fakeFeedback } = await import('./comment-list-fakes')
  return fakeFeedback()
})

vi.mock('frappe-ui', async () => {
  const { fakeFrappeUi } = await import('./comment-list-fakes')
  return fakeFrappeUi()
})

vi.mock('@/apps/drive', async () => {
  const { fakeDrive } = await import('./comment-list-fakes')
  return fakeDrive()
})

describe('resolving and reopening a thread', () => {
  it('keeps the open thread open while another is resolved from its row', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Is this right?'))
    await click(
      host.querySelector<HTMLButtonElement>(
        'li[data-thread="whole"] button[aria-label="Resolve"]',
      ) ?? undefined,
    )
    await settled()

    expect([asked, openRows(host)]).toEqual([['resolve whole true'], ['on-text']])
  })

  it('resolves the open thread from its ✓, closes it, and offers Undo for 5 seconds', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    const shown = toasts.map(({ message, duration, action }) => [message, duration, action.label])
    expect([asked, openRows(host), shown]).toEqual([
      ['resolve whole true'],
      [],
      [['Comment resolved', 5000, 'Undo']],
    ])
  })

  it('reopens that thread once on Undo', async () => {
    const { host, asked } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()
    toasts[0].action.onClick()
    await settled()

    expect(asked).toEqual(['resolve whole true', 'resolve whole false'])
  })

  it('closes the open thread when it is reopened from Resolved', async () => {
    const { host, asked, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))
    await click(labelled(host, 'Reopen'))
    await settled()

    expect([asked, opened]).toEqual([['resolve done false'], ['done', null]])
  })

  it('leaves the thread closed when Undo puts it back under Open', async () => {
    const { host, opened } = showList()

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()
    toasts[0].action.onClick()
    await settled()

    const isBack = rows(host).some((row) => row.includes('Looks good overall'))
    expect([opened, openRows(host), isBack]).toEqual([['whole', null], [], true])
  })

  it('offers no Undo when the thread could not be resolved', async () => {
    const { host, asked } = showList({ isRefusingResolve: true })

    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    expect([asked, toasts]).toEqual([['resolve whole true'], []])
  })

  it('sends one resolve for two quick clicks on the same ✓', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Looks good overall'))
    const resolveButton = labelled(host, 'Resolve')!

    resolveButton.click()
    resolveButton.click()
    await settled()

    expect(asked).toEqual(['resolve whole true'])
  })

  it('lets a thread be resolved again once a refused resolve comes back', async () => {
    const { host, asked } = showList({ isRefusingResolve: true })
    await click(rowButton(host, 'Looks good overall'))
    await click(labelled(host, 'Resolve'))
    await settled()

    await click(labelled(host, 'Resolve'))
    await settled()

    expect(asked).toEqual(['resolve whole true', 'resolve whole true'])
  })

  it('reopens a resolved thread from ↺ in the same spot, with no message', async () => {
    const { host, asked } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    const hasResolve = !!labelled(rowButton(host, 'Fixed the title').parentElement!, 'Resolve')
    await click(labelled(host, 'Reopen'))
    await settled()

    expect([hasResolve, asked, toasts]).toEqual([false, ['resolve done false'], []])
  })
})
