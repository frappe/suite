import type { CollabRoom } from '@suite/collab-client'
import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { anchorEnds, encodeAnchor } from '@/apps/writer/collab/anchors'
import { readDrafts } from '@/apps/writer/recovery/commentDrafts'

import { useCommentDrafts } from './useCommentDrafts'

vi.mock('frappe-ui', () => ({ toast: { error: vi.fn() } }))

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// An anchor on "hello", whose end characters the room below holds once saved
function helloAnchor() {
  const content = new Y.XmlText()
  new Y.Doc().getXmlFragment('default').insert(0, [content])
  content.insert(0, 'hello')
  return encodeAnchor(
    Y.createRelativePositionFromTypeIndex(content, 0, 0),
    Y.createRelativePositionFromTypeIndex(content, 5, -1),
    'hello',
  )
}

function refused() {
  return Promise.reject(new Error('Not allowed'))
}

function keyOf(id: Y.ID) {
  return `${id.client}:${id.clock}`
}

// A room that holds no text on the server until told to
function fakeRoom() {
  const listeners = new Set<() => void>()
  const saved = new Set<string>()
  const state = { stopped: null as string | null }
  const room = {
    doc: new Y.Doc(),
    get stopped() {
      return state.stopped
    },
    committedCovers: (items: readonly Y.ID[]) => items.every((id) => saved.has(keyOf(id))),
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as CollabRoom
  function tell() {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  function save(anchor: string) {
    for (const id of anchorEnds(anchor)) {
      saved.add(keyOf(id))
    }

    tell()
  }

  function stop() {
    state.stopped = 'refused'
    tell()
  }

  return { room, save, stop }
}

function driveComments(answers: (() => Promise<unknown>)[] = []) {
  const posts: unknown[][] = []
  const create = vi.fn((...input: unknown[]) => {
    posts.push(input)
    return answers.shift()?.() ?? Promise.resolve({})
  })
  const session = { nodeId: 'doc-1', comments: { create } } as unknown as Pick<
    DocumentSession,
    'comments' | 'nodeId'
  >
  return { session, posts }
}

function openDrafts(session: ReturnType<typeof driveComments>['session'], room: CollabRoom) {
  const refreshThreads = vi.fn(async () => {})
  const drafts = useCommentDrafts({ session, user: 'ann', room: () => room, refreshThreads })
  return { ...drafts, refreshThreads }
}

function settled() {
  return new Promise((resolve) => setTimeout(resolve))
}

describe('posting a comment on text', () => {
  it('waits until its text is saved, then posts once with its client id and forgets the draft', async () => {
    const { room, save } = fakeRoom()
    const { session, posts } = driveComments()
    const { drafts, start, write, post, refreshThreads } = openDrafts(session, room)
    const anchor = helloAnchor()
    start(anchor)
    const [draft] = drafts.value
    write(draft, '  Check this  ')

    const posting = post(draft)
    await settled()
    const waited = [posts.length, draft.isPosting]
    save(anchor)

    expect([await posting, waited, posts]).toEqual([
      true,
      [0, true],
      [[anchor, 'Check this', undefined, draft.clientId]],
    ])
    expect([drafts.value, readDrafts('ann', 'doc-1'), refreshThreads.mock.calls.length]).toEqual([
      [],
      [],
      1,
    ])
  })

  it('posts nothing and keeps the draft when its text can no longer be saved', async () => {
    const { room, stop } = fakeRoom()
    const { session, posts } = driveComments()
    const { drafts, start, write, post } = openDrafts(session, room)
    start(helloAnchor())
    write(drafts.value[0], 'Kept')

    const posting = post(drafts.value[0])
    stop()

    expect([await posting, posts, drafts.value[0].isPosting]).toEqual([false, [], false])
    expect(readDrafts('ann', 'doc-1').map((draft) => draft.text)).toEqual(['Kept'])
    expect(vi.mocked(toast.error)).toHaveBeenCalledOnce()
  })

  it('keeps a draft Drive refused, and sends the same client id when tried again', async () => {
    const { room, save } = fakeRoom()
    const { session, posts } = driveComments([refused])
    const { drafts, start, write, post } = openDrafts(session, room)
    const anchor = helloAnchor()
    save(anchor)
    start(anchor)
    write(drafts.value[0], 'Again')
    const [draft] = drafts.value

    const results = [await post(draft), readDrafts('ann', 'doc-1').length, await post(draft)]

    expect([results, posts.map((input) => input[3])]).toEqual([
      [false, 1, true],
      [draft.clientId, draft.clientId],
    ])
  })

  it('shows the drafts left on this device when the document opens again', () => {
    const { room } = fakeRoom()
    const first = openDrafts(driveComments().session, room)
    first.start(helloAnchor())
    first.write(first.drafts.value[0], 'Left here')

    const reopened = openDrafts(driveComments().session, room)

    expect(reopened.drafts.value.map((draft) => [draft.text, draft.isPosting])).toEqual([
      ['Left here', false],
    ])
  })

  it('posts nothing when the draft is discarded while its text saves', async () => {
    const { room, save } = fakeRoom()
    const { session, posts } = driveComments()
    const { drafts, start, discard, post } = openDrafts(session, room)
    const anchor = helloAnchor()
    start(anchor)
    const [draft] = drafts.value

    const posting = post(draft)
    discard(draft)
    save(anchor)

    expect([await posting, posts, readDrafts('ann', 'doc-1')]).toEqual([false, [], []])
  })
})
