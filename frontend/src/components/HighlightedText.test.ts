import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'

import HighlightedText from './HighlightedText.vue'

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(props: Record<string, unknown>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(HighlightedText, props) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

describe('HighlightedText given segments', () => {
  it('marks only the words the server found', () => {
    const root = render({
      segments: [
        { text: 'the ', hit: false },
        { text: 'budget', hit: true },
        { text: ' for May', hit: false },
      ],
    })

    expect(root.textContent).toBe('the budget for May')
    expect([...root.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['budget'])
  })

  it('shows what a mail wrote as text, never as markup', () => {
    const written = '<img src=x onerror=alert(1)><mark>fake</mark>'
    const root = render({ segments: [{ text: written, hit: false }] })

    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('mark')).toBeNull()
    expect(root.textContent).toBe(written)
  })
})
