import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openDraftsDb } from './drafts'

vi.stubGlobal('caches', { delete: async () => true })

const draft = (id: string, user?: string) => ({
  id,
  user,
  content: [],
  updatedAt: 1,
  dirty: true,
})

async function putDrafts(name: string, records: object[]) {
  const db = await openDraftsDb(name)
  const tx = db.transaction('presentations', 'readwrite')
  records.forEach((record) => tx.objectStore('presentations').put(record))
  await new Promise((resolve) => (tx.oncomplete = resolve))
  db.close()
}

async function draftIds(name: string) {
  const db = await openDraftsDb(name)
  const request = db.transaction('presentations').objectStore('presentations').getAllKeys()
  const keys = await new Promise((resolve) => (request.onsuccess = () => resolve(request.result)))
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
    await putDrafts('slides-db', [draft('p1', 'a@x.com'), draft('p2')])
    localStorage.setItem('slides-caches-user', 'a@x.com')

    await signIn('b@x.com')
    await signIn('a@x.com')

    expect(await draftIds('slides-db:a@x.com')).toEqual(['p1', 'p2'])
    expect(await draftIds('slides-db:b@x.com')).toEqual([])
    const dbNames = (await indexedDB.databases()).map((db) => db.name)
    expect(dbNames).not.toContain('slides-db')
  })

  it('keeps a draft with no known owner until someone takes it', async () => {
    await putDrafts('slides-db', [draft('p1')])

    await signIn('b@x.com')

    expect(await draftIds('slides-db')).toEqual(['p1'])
    const { takeUnownedDraft } = await import('./drafts')
    expect(await takeUnownedDraft('p1', 'b@x.com')).toMatchObject({ id: 'p1', user: 'b@x.com' })
    expect(await draftIds('slides-db:b@x.com')).toEqual(['p1'])
  })
})
