import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'

import type { SearchMatch as Match } from '@/apps/mail/types'

import SearchMatch from './SearchMatch.vue'

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(match: Partial<Match>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(SearchMatch, { match: match as Match }) })
  // Auto-registered in the app; its own test covers how the words show.
  app.component('HighlightedText', { render: () => null })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

describe('SearchMatch', () => {
  const found = [{ text: 'budget', hit: true }]

  it('says when the words are in an attachment, where the open mail will not show them', () => {
    expect(render({ snippet: found, in_attachment: 1 }).textContent).toContain('In an attachment')
  })

  it('says nothing of attachments for words in the mail itself', () => {
    expect(render({ snippet: found, in_attachment: 0 }).textContent).not.toContain('attachment')
  })
})
