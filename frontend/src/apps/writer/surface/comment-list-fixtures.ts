import { afterEach } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import type { DocumentThread } from '@/apps/drive'
import type { ThreadPlace } from '@/apps/writer/collab/places'
import { translationPlugin } from '@/platform/translation'

import { confirmed, errors, me, toasts, warnings } from './comment-list-fakes'
import CommentList from './CommentList.vue'
import type { ShownDraft, useCommentDrafts } from './useCommentDrafts'
import type { ThreadActions } from './useDocumentPanel'

export const TODAY = new Date().toISOString()

export function comment(name: string, author: string, content: string) {
  return {
    name,
    author,
    author_name: null,
    person: { full_name: author },
    content,
    creation: TODAY,
  }
}

export const ON_TEXT = {
  name: 'on-text',
  resolved: false,
  comments: [
    comment('c1', 'Asha Rao', 'Is this right?'),
    comment('c2', 'Ben Ito', 'Yes'),
    comment('c3', 'Asha Rao', 'Thanks'),
  ],
} as unknown as DocumentThread

export const WHOLE = {
  name: 'whole',
  resolved: false,
  comments: [comment('c4', 'Ben Ito', 'Looks good overall')],
} as unknown as DocumentThread

export const DONE = {
  name: 'done',
  resolved: true,
  comments: [comment('c5', 'Asha Rao', 'Fixed the title'), comment('c6', 'Ben Ito', 'Thanks')],
} as unknown as DocumentThread

export const PLACES = new Map<string, ThreadPlace>([
  ['on-text', { kind: 'text', from: 5, to: 9, quote: 'the words' }],
  ['whole', { kind: 'document' }],
  ['done', { kind: 'deleted', quote: 'gone' }],
])

export let mounted: App | null = null

export function setMounted(app: App | null) {
  mounted = app
}

// jsdom lays nothing out, so has nothing to scroll
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
  localStorage.clear()
  sessionStorage.clear()
  confirmed.asked = []
  confirmed.answer = true
  toasts.length = 0
  warnings.length = 0
  errors.length = 0
  me.id = 'Asha Rao'
})

// Drafts as useCommentDrafts shows them, each post answered in turn by the thread Drive made or null
export function fakeDrafts(shown: Partial<ShownDraft>[] = [], answers: (string | null)[] = []) {
  function made(index: number, draft: Partial<ShownDraft>): ShownDraft {
    return {
      clientId: `draft-${index}`,
      anchor: 'on-some-text',
      text: '',
      isSent: false,
      isPosting: false,
      ...draft,
    }
  }

  const drafts = ref<ShownDraft[]>(shown.map((draft, index) => made(index, draft)))
  const posted: string[] = []
  const list = {
    drafts,
    start: (anchor: string) => {
      drafts.value = [...drafts.value, made(drafts.value.length, { anchor })]
    },
    write: (draft: ShownDraft, text: string) => {
      draft.text = text
    },
    discard: (draft: ShownDraft) => {
      drafts.value = drafts.value.filter((kept) => kept.clientId !== draft.clientId)
    },
    post: async (draft: ShownDraft) => {
      posted.push(draft.clientId)
      return answers.shift() ?? null
    },
  }
  return { posted, list: list as unknown as ReturnType<typeof useCommentDrafts> }
}

// The list over the three threads, recording each change it asks for and each thread it opens or lights
export function showList({
  canComment = true,
  threads = [ON_TEXT, WHOLE, DONE],
  openThread = null as string | null,
  isRefusingResolve = false,
  isRefusingEdit = false,
  refusedReplies = 0,
  heldReplies = Promise.resolve(),
  canEditDocument = false,
  drafts = fakeDrafts().list,
} = {}) {
  const asked: string[] = []
  const replyIds: string[] = []
  let refusalsLeft = refusedReplies
  const opened: (string | null)[] = []
  const lit: (string | null)[] = []
  const shown = ref(openThread)
  const listed = ref(threads)
  function open(name: string | null) {
    opened.push(name)
    shown.value = name
  }

  function record(change: string) {
    asked.push(change)
    return Promise.resolve(true)
  }

  const actions: ThreadActions = {
    reply: async (thread, text, _authorName, clientId) => {
      replyIds.push(clientId)
      await record(`reply ${thread} "${text}"`)
      await heldReplies
      refusalsLeft -= 1
      return refusalsLeft < 0
    },
    resolve: async (thread, isResolved) => {
      await record(`resolve ${thread} ${isResolved}`)
      if (isRefusingResolve) {
        return false
      }

      // Read again before answering, as the panel's resolve does
      const changed = [...listed.value]
      const index = changed.findIndex((listedThread) => listedThread.name === thread)
      changed[index] = { ...changed[index], resolved: isResolved }
      listed.value = changed
      return true
    },
    editComment: async (name, text) => (await record(`edit ${name} "${text}"`)) && !isRefusingEdit,
    removeComment: (name) => record(`remove ${name}`),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(CommentList, {
      threads: listed.value,
      readAt: 1,
      node: 'doc-1',
      places: PLACES,
      canComment,
      canEditDocument,
      actions,
      drafts,
      openThread: shown.value,
      'onUpdate:openThread': open,
      'onUpdate:litThread': (name: string | null) => lit.push(name),
    }),
  )
  app.use(translationPlugin).mount(host)
  mounted = app
  return { host, asked, opened, lit, listed, replyIds }
}

// Each row's words, one piece of text after another
export function rows(host: Element) {
  return [...host.querySelectorAll('li:not([role="none"])')].map((row) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const pieces: string[] = []
    while (walker.nextNode()) {
      pieces.push(walker.currentNode.textContent?.trim() ?? '')
    }

    return pieces.filter(Boolean).join(' ')
  })
}

export function buttonNamed(host: Element, name: string) {
  return [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

export function labelled(host: Element, label: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined
}

// The toggle of the row holding the text, open or closed
export function rowButton(host: Element, text: string) {
  const row = [...host.querySelectorAll('li')].find((item) => item.textContent?.includes(text))
  return row!.querySelector<HTMLButtonElement>(':scope > button')!
}

export async function click(button: HTMLElement | undefined) {
  button!.click()
  await nextTick()
}

export async function settled() {
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

// Vue skips a handler attached in the same millisecond as the event
export async function letHandlersAttach() {
  const calledAt = Date.now()
  while (Date.now() <= calledAt) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

export function openRows(host: Element) {
  return [...host.querySelectorAll('li:not([role="none"]) > button[aria-expanded="true"]')].map(
    (button) => button.closest('li')!.dataset.thread ?? '',
  )
}

// "é" is two bytes, so these sit either side of Drive's 65,535-byte limit on a comment
const LONGEST_CHARS = 32_767
const TOO_LONG_CHARS = 32_768
export const LONGEST = 'é'.repeat(LONGEST_CHARS) + 'x'
export const TOO_LONG = 'é'.repeat(TOO_LONG_CHARS)
export const TOO_LONG_MESSAGE = 'This comment is too long. Shorten it and try again.'
