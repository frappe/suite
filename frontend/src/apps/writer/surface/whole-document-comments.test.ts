import { describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import { translationPlugin } from '@/platform/translation'

import { confirmed, errors } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  DONE,
  fakeDrafts,
  letHandlersAttach,
  LONGEST,
  PLACES,
  rowButton,
  rows,
  setMounted,
  settled,
  showList,
  TOO_LONG,
  TOO_LONG_MESSAGE,
} from './comment-list-fixtures'
import CommentList from './CommentList.vue'
import type { ThreadActions } from './useDocumentPanel'

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

describe('commenting on the whole document', () => {
  function documentBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Add a comment"]')
  }

  async function type(text: string) {
    documentBox()!.value = text
    documentBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  // The list with a handle to start a whole-document comment, as Ctrl+Alt+M does
  function showStartableList(drafts = fakeDrafts().list) {
    const host = document.createElement('div')
    document.body.append(host)
    const list = ref<{ startDocumentComment(): Promise<void> } | null>(null)
    const props = {
      ref: list,
      threads: [DONE],
      readAt: 1,
      node: 'doc-1',
      places: PLACES,
      canComment: true,
      canEditDocument: false,
      actions: {} as ThreadActions,
      drafts,
    }
    const app = createApp(() => h(CommentList, props))
    app.use(translationPlugin).mount(host)
    setMounted(app)
    return { host, start: () => list.value!.startDocumentComment() }
  }

  it('turns the line into a focused box in its place, and posts what is typed', async () => {
    const { list, posted } = fakeDrafts()
    const { host } = showList({ drafts: list })

    await click(buttonNamed(host, 'Add a comment'))
    await nextTick()
    const isFocused = document.activeElement === documentBox()
    const hasLine = !!buttonNamed(host, 'Add a comment')
    await type('Ship it')
    documentBox()!.closest('form')!.requestSubmit()
    await settled()
    const kept = list.drafts.value.map(({ anchor, text }) => `${anchor} "${text}"`)

    expect([isFocused, hasLine, posted, kept]).toEqual([
      true,
      false,
      ['draft-0'],
      ['document "Ship it"'],
    ])
  })

  it('posts no comment over the limit, keeping its box and words and saying why, but posts one at it', async () => {
    const { list, posted } = fakeDrafts()
    const { host } = showList({ drafts: list })
    await click(buttonNamed(host, 'Add a comment'))
    await nextTick()

    await type(TOO_LONG)
    documentBox()!.closest('form')!.requestSubmit()
    await settled()
    const isKept = documentBox()?.value === TOO_LONG
    const postedOverLimit = [...posted]
    await type(LONGEST)
    documentBox()!.closest('form')!.requestSubmit()
    await settled()

    expect([isKept, postedOverLimit, errors, posted]).toEqual([
      true,
      [],
      [TOO_LONG_MESSAGE],
      ['draft-0'],
    ])
  })

  it('opens the box at the top when asked from elsewhere, with Resolved unfolded', async () => {
    const { host, start } = showStartableList()
    await click(buttonNamed(host, 'Resolved · 1'))

    await start()

    expect(document.activeElement === documentBox()).toBe(true)
  })

  it('keeps one box, putting the cursor back in it with its words when asked again', async () => {
    const { list } = fakeDrafts()
    const { host, start } = showStartableList(list)
    await start()
    await type('Half a thought')
    documentBox()!.blur()

    await start()

    const boxes = host.querySelectorAll('textarea[aria-label="Add a comment"]').length
    const isFocused = document.activeElement === documentBox()
    expect([boxes, list.drafts.value.length, isFocused, documentBox()?.value]).toEqual([
      1,
      1,
      true,
      'Half a thought',
    ])
  })

  it('keeps a comment on text in its own box beside the whole-document one', () => {
    const { list } = fakeDrafts([{ anchor: 'document' }, { text: 'On the text' }])
    const { host } = showList({ drafts: list })

    const boxes = [...host.querySelectorAll('textarea')].map((box) => [
      box.getAttribute('aria-label'),
      box.placeholder,
    ])
    expect(boxes).toEqual([
      ['Add a comment', 'Add a comment'],
      ['Add a comment on the text', 'Add a comment'],
    ])
  })

  it('closes an empty box without asking, and asks before dropping typed words, on Cancel or Esc', async () => {
    const { host } = showList()

    await click(buttonNamed(host, 'Add a comment'))
    await click(buttonNamed(host, 'Cancel'))
    await settled()
    const afterEmpty = [documentBox(), confirmed.asked.length]
    await click(buttonNamed(host, 'Add a comment'))
    await type('Half a thought')
    confirmed.answer = false
    await click(buttonNamed(host, 'Cancel'))
    await settled()
    await letHandlersAttach()
    documentBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()
    const afterNo = documentBox()?.value
    confirmed.answer = true
    documentBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()

    expect([afterEmpty, afterNo, confirmed.asked, documentBox()]).toEqual([
      [null, 0],
      'Half a thought',
      ['Discard comment?', 'Discard comment?', 'Discard comment?'],
      null,
    ])
  })

  it('closes a box holding only spaces when another comment opens, bringing the line back', async () => {
    const { host } = showList()
    await click(buttonNamed(host, 'Add a comment'))
    await type('   ')

    await click(rowButton(host, 'Is this right?'))
    await settled()

    expect([documentBox(), !!buttonNamed(host, 'Add a comment'), confirmed.asked]).toEqual([
      null,
      true,
      [],
    ])
  })

  it('keeps a box with typed words open when another comment opens', async () => {
    const { host } = showList()
    await click(buttonNamed(host, 'Add a comment'))
    await type('Half a thought')

    await click(rowButton(host, 'Is this right?'))
    await settled()

    expect([documentBox()?.value, confirmed.asked]).toEqual(['Half a thought', []])
  })

  it('shows no place word on a comment to the whole document that is posting', () => {
    const { list } = fakeDrafts([
      { anchor: 'document', text: 'Ship it', isSent: true, isPosting: true },
    ])
    const { host } = showList({ threads: [], drafts: list })

    expect(rows(host)).toEqual(['You Posting… Ship it'])
  })
})
