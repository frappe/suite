import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { confirmed, errors, me, warnings } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  comment,
  labelled,
  letHandlersAttach,
  LONGEST,
  mounted,
  ON_TEXT,
  openRows,
  rowButton,
  rows,
  settled,
  showList,
  TOO_LONG,
  TOO_LONG_MESSAGE,
  WHOLE,
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

describe('editing and deleting a comment', () => {
  function menus(host: Element) {
    return host.querySelectorAll('button[aria-label="More comment actions"]').length
  }

  // The ⋯ buttons shown without being pointed at
  function alwaysShown(host: Element) {
    return [...host.querySelectorAll('button[aria-label="More comment actions"]')].filter(
      (button) => !button.closest('.invisible'),
    ).length
  }

  function editBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')
  }

  async function type(text: string) {
    editBox()!.value = text
    editBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  // Opens the ⋯ menu of the comment with the text and picks an item from it
  async function pick(host: Element, text: string, item: string) {
    const block = [...host.querySelectorAll('li div')].find(
      (element) => element.querySelector(':scope > p:not(.flex)')?.textContent?.trim() === text,
    )
    await click(labelled(block!, 'More comment actions'))
    const option = [...block!.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent === item,
    )
    await click(option as HTMLElement)
    await nextTick()
  }

  async function save() {
    editBox()!.closest('form')!.requestSubmit()
    await settled()
  }

  it('offers ⋯ on an open thread’s own comments to its author, and on all of them to an editor', async () => {
    const seen: number[] = []
    for (const options of [{}, { canEditDocument: true }, { canComment: false }]) {
      const { host } = showList({ threads: [ON_TEXT], ...options })
      seen.push(menus(host))
      await click(rowButton(host, 'Is this right?'))
      seen.push(menus(host))
      mounted?.unmount()
      document.body.replaceChildren()
    }

    expect(seen).toEqual([0, 2, 0, 3, 0, 0])
  })

  it('names the author above each reply, but not again above the first comment', async () => {
    const { host } = showList({ threads: [ON_TEXT] })

    await click(rowButton(host, 'Is this right?'))
    const authorLines = [...host.querySelectorAll('div[class~="group/comment"] > p.flex')]

    expect(authorLines.map((line) => line.textContent?.trim())).toEqual([
      expect.stringMatching(/^Ben Ito/),
      expect.stringMatching(/^Asha Rao/),
    ])
  })

  it('offers a guest no ⋯, even on comments made as a guest', async () => {
    me.id = 'Guest'
    const byGuest = {
      ...WHOLE,
      comments: [comment('c9', 'Guest', 'From a guest')],
    } as unknown as DocumentThread
    const { host } = showList({ threads: [byGuest] })

    await click(rowButton(host, 'From a guest'))

    expect(menus(host)).toBe(0)
  })

  it('edits a comment in place, with the cursor in it, and saves the new words', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await pick(host, 'Is this right?', 'Edit')
    const opened = [editBox()?.value, document.activeElement === editBox()]
    await type(' Is this still right? ')
    await save()

    expect([opened, asked, editBox()]).toEqual([
      ['Is this right?', true],
      ['edit c1 "Is this still right?"'],
      null,
    ])
  })

  it('cancels an edit on Esc, sending nothing and keeping the thread open', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Thanks', 'Edit')
    await type('Changed my mind')

    await letHandlersAttach()
    editBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect([asked, editBox(), openRows(host), host.textContent]).toEqual([
      [],
      null,
      ['on-text'],
      expect.stringContaining('Thanks'),
    ])
  })

  it('hides ⋯ on the comment being edited, and Cancel closes the box sending nothing', async () => {
    const { host, asked } = showList({ threads: [ON_TEXT] })
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Thanks', 'Edit')
    await type('Changed my mind')

    const whileEditing = menus(host)
    await click(buttonNamed(host, 'Cancel')!)

    expect([whileEditing, asked, editBox(), menus(host)]).toEqual([1, [], null, 2])
  })

  it('hides ⋯ again until pointed at once an edit picked from it is saved or cancelled', async () => {
    const { host } = showList({ threads: [ON_TEXT] })
    await click(rowButton(host, 'Is this right?'))

    await pick(host, 'Thanks', 'Edit')
    await type('Thanks again')
    await save()
    const afterSave = alwaysShown(host)
    await pick(host, 'Is this right?', 'Edit')
    await click(buttonNamed(host, 'Cancel'))

    expect([afterSave, alwaysShown(host)]).toEqual([0, 0])
  })

  it('sends nothing for an unchanged comment, and can’t save an empty one', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type('')
    const isSaveOff = buttonNamed(host, 'Save')!.disabled
    await type('Is this right?')
    await save()

    expect([isSaveOff, asked, editBox()]).toEqual([true, [], null])
  })

  it('shows the people a comment mentions by name to edit, and saves them as mentions', async () => {
    const asking = {
      ...WHOLE,
      comments: [
        { ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com] or @[ghost]'), mentions: ['ben@x.com'] },
      ],
    } as unknown as DocumentThread
    const { host, asked } = showList({ threads: [asking] })
    await click(rowButton(host, 'Ask'))

    await pick(host, 'Ask @Ben Roy or @[ghost]', 'Edit')
    const opened = editBox()?.value
    await type(`${opened} now`)
    await save()

    expect([opened, asked]).toEqual([
      'Ask @Ben Roy or @[ghost]',
      ['edit c8 "Ask @[ben@x.com] or @[ghost] now"'],
    ])
  })

  it('names a mentioned person to edit whatever the case of their mention, and saves the mention as stored', async () => {
    const asking = {
      ...WHOLE,
      comments: [
        { ...comment('c8', 'Asha Rao', 'Ask @[BEN@x.com] or @[ghost]'), mentions: ['ben@x.com'] },
      ],
    } as unknown as DocumentThread
    const { host, asked } = showList({ threads: [asking] })
    await click(rowButton(host, 'Ask'))

    await pick(host, 'Ask @Ben Roy or @[ghost]', 'Edit')
    const opened = editBox()?.value
    await type(`${opened} now`)
    await save()

    expect([opened, asked]).toEqual([
      'Ask @Ben Roy or @[ghost]',
      ['edit c8 "Ask @[BEN@x.com] or @[ghost] now"'],
    ])
  })

  it('keeps the box and the words when the edit is refused', async () => {
    const { host, asked } = showList({ isRefusingEdit: true })
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type('Reworded')
    await save()

    expect([asked, editBox()?.value]).toEqual([['edit c1 "Reworded"'], 'Reworded'])
  })

  it('saves no edit over the limit, keeping the box and words and saying why, but saves one at it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await pick(host, 'Is this right?', 'Edit')

    await type(TOO_LONG)
    await save()
    const isKept = editBox()?.value === TOO_LONG
    await type(LONGEST)
    await save()

    expect([isKept, errors, asked.length, asked[0] === `edit c1 "${LONGEST}"`]).toEqual([
      true,
      [TOO_LONG_MESSAGE],
      1,
      true,
    ])
  })

  it('asks before deleting a comment, and deletes only once confirmed', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    confirmed.answer = false
    await pick(host, 'Thanks', 'Delete')
    await settled()
    confirmed.answer = true
    await pick(host, 'Thanks', 'Delete')
    await settled()

    expect([confirmed.asked, asked]).toEqual([
      ['Delete this comment?', 'Delete this comment?'],
      ['remove c3'],
    ])
  })

  it('leads the row with the first reply once the first comment is deleted', async () => {
    const { host, listed } = showList()

    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(1) }, WHOLE]
    await nextTick()

    const [, reply] = rows(host)
    expect(reply).toMatch(/^Ben Ito \S.* Yes · 1 reply$/)
  })
})

describe('an edit while someone else changes the comment', () => {
  function editBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]')
  }

  async function startEditing(options = {}) {
    const list = showList(options)
    await click(rowButton(list.host, 'Is this right?'))
    const menu = list.host.querySelector('li [role="menuitem"]') as HTMLElement
    await click(menu)
    editBox()!.value = 'Mine'
    editBox()!.dispatchEvent(new Event('input'))
    await nextTick()
    return list
  }

  it('keeps my words when another tab edits it, and my save wins', async () => {
    const { asked, listed } = await startEditing()
    const theirs = { ...ON_TEXT.comments[0], content: 'Theirs' }

    listed.value = [{ ...ON_TEXT, comments: [theirs, ...ON_TEXT.comments.slice(1)] }, WHOLE]
    await nextTick()
    const kept = editBox()?.value
    editBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([kept, asked]).toEqual(['Mine', ['edit c1 "Mine"']])
  })

  it('keeps the box when the save is refused because it was deleted before the list knew', async () => {
    const { asked } = await startEditing({ isRefusingEdit: true })

    editBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([asked, editBox()?.value, warnings]).toEqual([['edit c1 "Mine"'], 'Mine', []])
  })

  it('closes the box and says once that the edit wasn’t saved when the list shows it deleted', async () => {
    const { listed } = await startEditing()

    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(1) }, WHOLE]
    await nextTick()
    listed.value = [{ ...ON_TEXT, comments: ON_TEXT.comments.slice(2) }]
    await nextTick()

    expect([editBox(), warnings]).toEqual([
      null,
      ["This comment was deleted, so your edit wasn't saved."],
    ])
  })

  it('says nothing when the list changes but the comment being edited is still there', async () => {
    const { listed } = await startEditing()

    listed.value = [ON_TEXT]
    await nextTick()

    expect([editBox()?.value, warnings]).toEqual(['Mine', []])
  })
})
