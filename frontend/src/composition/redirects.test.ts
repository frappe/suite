import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

import { redirectOldPath } from './redirects'

const Page = defineComponent({ setup: () => () => h('div') })

/**
 * A router with a catch-all page and the redirect guard. It starts on `/home`
 * unless `firstLoad` is set, so each case is a click inside the app.
 */
async function openPath(path: string, { firstLoad = false } = {}) {
  const loads: string[] = []
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Page }],
  })
  router.beforeEach((to, from) => redirectOldPath(to, from, (url) => loads.push(url)) ?? true)
  if (!firstLoad) await router.push('/home')
  await router.push(path)
  return { at: router.currentRoute.value.fullPath, loads }
}

describe('old links clicked inside the app', () => {

  it.each([
    ['/drive/recents', '/drive/recent'],
    ['/drive/favourites', '/drive/starred'],
    ['/drive/shared', '/drive/shared-with-me'],
    ['/drive/inbox', '/drive'],
    ['/drive/attachments/Task/TASK-1', '/drive'],
    ['/drive/documents', '/drive/recent?type=document'],
    ['/drive/presentations', '/drive/recent?type=presentation'],
    ['/writer', '/drive/recent?type=document'],
    ['/drive/d/folder-1', '/drive/f/folder-1'],
    ['/drive/w/doc-1', '/d/doc-1'],
    ['/writer/w/doc-1', '/d/doc-1'],
    ['/suite', '/home'],
    ['/suite/start', '/home'],
  ])('%s goes to %s in the app', async (old, expected) => {
    expect(await openPath(old)).toEqual({ at: expected, loads: [] })
  })

  it('drops a slug and a trailing slash, and keeps the query and the hash', async () => {
    expect((await openPath('/drive/d/folder-1/q3-plans/?view=grid#top')).at).toBe('/drive/f/folder-1?view=grid#top')
    expect((await openPath('/drive/w/doc-1/brief')).at).toBe('/d/doc-1')
  })

  it('keeps a target query, and the old query adds its other keys', async () => {
    expect((await openPath('/drive/documents?x=1')).at).toBe('/drive/recent?type=document&x=1')
    expect((await openPath('/writer?type=sheets&sort=name')).at).toBe('/drive/recent?type=document&sort=name')
  })

  it.each([
    '/drive/g/node-1',
    '/drive/t/team-1/d/node-1',
    '/drive/folder/old-1',
    '/drive/t/team-1',
    '/drive/l/L000000000000000000001',
    '/sheets/SH-0001?cell=B2',
    '/slides/presentation/deck-1?slide=3',
    '/slides/presentation/view/deck-1',
    '/slides/slideshow/deck-1',
    '/sheets',
    '/sheets/new',
    '/sheets/trash',
    '/slides/presentation/new',
  ])('%s loads the page from the server, which reads the node', async (old) => {
    const { loads } = await openPath(old)
    expect(loads).toEqual([old])
  })

  it('leaves a path with an encoded slash or backslash where it is, as the server does', async () => {
    expect(await openPath('/drive/w/doc-1')).toEqual({ at: '/d/doc-1', loads: [] })
    for (const path of ['/drive/w/a%2Fb', '/drive/w/a%2fb', '/drive/d/a%5Cb', '/drive/recents/x%2Fy']) {
      expect(await openPath(path)).toEqual({ at: path, loads: [] })
    }
    expect(await openPath('/drive/g/a%2Fb')).toEqual({ at: '/drive/g/a%2Fb', loads: [] })
  })

  it('on the first load, a lookup the server fell through stays put and does not reload', async () => {
    expect(await openPath('/drive/g/missing', { firstLoad: true })).toEqual({ at: '/drive/g/missing', loads: [] })
    expect(await openPath('/sheets/SH-missing', { firstLoad: true })).toEqual({ at: '/sheets/SH-missing', loads: [] })
  })

  it('on the first load, a Sheets or Slides page with a fixed target goes there in the app', async () => {
    expect(await openPath('/sheets/new', { firstLoad: true })).toEqual({ at: '/home', loads: [] })
    expect(await openPath('/slides?x=1', { firstLoad: true })).toEqual({ at: '/drive/recent?type=presentation&x=1', loads: [] })
  })

  it.each(['/suite/setup', '/suite/load-error', '/drive', '/drive/trash', '/drive/f/node-1', '/mail/inbox', '/home'])(
    '%s stays',
    async (path) => {
      expect(await openPath(path)).toEqual({ at: path, loads: [] })
    },
  )
})
