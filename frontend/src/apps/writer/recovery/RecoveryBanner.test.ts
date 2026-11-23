import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'

import { translationPlugin } from '@/platform/translation'

import { discardCopy, listCopies } from './copies'
import RecoveryBanner from './RecoveryBanner.vue'

function keepCopy(key: string, savedAt: string, html: string) {
  localStorage.setItem(key, JSON.stringify({ node: 'node-1', title: 'Plan', savedAt, html }))
}

async function mountBanner() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(RecoveryBanner, { node: 'node-1' })
  app.use(translationPlugin).mount(root)
  for (let tick = 0; tick < 5; tick++) {
    await nextTick()
    await new Promise((done) => setTimeout(done))
  }

  return { root, unmount: () => app.unmount() }
}

afterEach(async () => {
  const copies = await listCopies()
  await Promise.all(copies.map(discardCopy))
  document.body.innerHTML = ''
})

describe('Writer recovery banner', () => {
  it('shows one notice, for the latest copy, while older copies stay on the device', async () => {
    keepCopy('suite:writer-recovery:node-1:a', '2026-09-29T10:00:00.000Z', '<p>older</p>')
    keepCopy('suite:writer-recovery:node-1:b', '2026-09-29T12:00:00.000Z', '<p>latest</p>')
    const latest = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

    const banner = await mountBanner()

    const notices = banner.root.querySelectorAll('[role="status"]')
    expect(notices).toHaveLength(1)
    expect(notices[0].textContent).toContain(latest.format(new Date('2026-09-29T12:00:00.000Z')))
    expect(await listCopies('node-1')).toHaveLength(2)
    banner.unmount()
  })
})
