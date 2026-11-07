import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  click,
  labelled,
  letHandlersAttach,
  rowButton,
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

vi.mock('@/apps/writer/drive', async () => {
  const { fakeWriterDrive } = await import('./comment-list-fakes')
  return fakeWriterDrive()
})

describe('Enter in the box that edits a comment', () => {
  function editBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')
  }

  async function type(text: string) {
    editBox()!.value = text
    editBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  async function press(options: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...options })
    await letHandlersAttach()
    editBox()!.dispatchEvent(event)
    await settled()
    return event.defaultPrevented
  }

  async function startEditing(host: Element) {
    await click(rowButton(host, 'Is this right?'))
    const owner = rowButton(host, 'Is this right?').closest('li')!
    await click(labelled(owner, 'More comment actions'))
    const edit = [...owner.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent === 'Edit',
    )
    await click(edit as HTMLElement)
    await nextTick()
  }

  it('saves the new words on Enter', async () => {
    const { host, asked } = showList()
    await startEditing(host)

    await type('Is this still right?')
    const isKeptOutOfBox = await press({})

    expect([asked, isKeptOutOfBox, editBox()]).toEqual([
      ['edit c1 "Is this still right?"'],
      true,
      null,
    ])
  })

  it('keeps a new line on Shift+Enter or while a word is being composed', async () => {
    const { host, asked } = showList()
    await startEditing(host)

    await type('Is this still right?')
    const pressed = [
      await press({ shiftKey: true }),
      await press({ isComposing: true }),
      await press({ keyCode: 229 }),
    ]

    expect([asked, pressed, editBox()?.value]).toEqual([
      [],
      [false, false, false],
      'Is this still right?',
    ])
  })

  it('sends nothing on Enter in an empty box, and keeps the line out of it', async () => {
    const { host, asked } = showList()
    await startEditing(host)

    await type('   ')
    const isKeptOutOfBox = await press({})

    expect([asked, isKeptOutOfBox, editBox()?.value]).toEqual([[], true, '   '])
  })
})
