import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openDrafts } from './drafts'

vi.stubGlobal('caches', { delete: async () => true })

const draft = (id: string, user?: string) => ({
  id,
  user,
  content: [],
  updatedAt: 1,
  dirty: true,
})

async function put(name: string, records: object[]) {
  const db = await openDrafts(name)
  const tx = db.transaction('presentations', 'readwrite')
  records.forEach((record) => tx.objectStore('presentations').put(record))
  await new Promise((resolve) => (tx.oncomplete = resolve))
  db.close()
}

async function ids(name: string) {
  const db = await openDrafts(name)
  const req = db.transaction('presentations').objectStore('presentations').getAllKeys()
  const keys = await new Promise((resolve) => (req.onsuccess = () => resolve(req.result)))
  db.close()
  return keys
}

async function signIn(user: string) {
  vi.resetModules()
  const { claimSlidesCachesFor } = await import('./serviceWorker')
  await claimSlidesCachesFor(user)
}

beforeEach(async () => {
  localStorage.clear()
  for (const { name } of await indexedDB.databases()) {
    indexedDB.deleteDatabase(name!)
  }
})

describe('drafts per user', () => {
  it("keeps a user's drafts when another user signs in, and moves the shared ones to their owner", async () => {
    await put('slides-db', [draft('p1', 'a@x.com'), draft('p2')])
    localStorage.setItem('slides-caches-user', 'a@x.com')

    await signIn('b@x.com')
    await signIn('a@x.com')

    expect(await ids('slides-db:a@x.com')).toEqual(['p1', 'p2'])
    expect(await ids('slides-db:b@x.com')).toEqual([])
    const names = (await indexedDB.databases()).map((db) => db.name)
    expect(names).not.toContain('slides-db')
  })

  it('keeps a draft with no known owner until someone takes it', async () => {
    await put('slides-db', [draft('p1')])

    await signIn('b@x.com')

    expect(await ids('slides-db')).toEqual(['p1'])
    const { takeUnownedDraft } = await import('./drafts')
    expect(await takeUnownedDraft('p1', 'b@x.com')).toMatchObject({ id: 'p1', user: 'b@x.com' })
    expect(await ids('slides-db:b@x.com')).toEqual(['p1'])
  })
})
