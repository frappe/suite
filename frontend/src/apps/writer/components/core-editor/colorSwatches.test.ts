// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'

import { requireTestElement } from '@/test/dom'

import ColorPanel from './ColorPanel.vue'
import CellColorSwatches from './table/CellColorSwatches.vue'

const NAMES = ['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Cyan', 'Blue', 'Indigo']
const LAST = ['Purple', 'Pink', 'Gray']

let app: App | undefined
let editor: Editor | undefined

afterEach(() => {
  app?.unmount()
  editor?.destroy()
  app = editor = undefined
})

function mount(
  component: typeof ColorPanel | typeof CellColorSwatches,
  props:
    InstanceType<typeof ColorPanel>['$props'] | InstanceType<typeof CellColorSwatches>['$props'],
) {
  const root = document.createElement('div')
  app = createApp({ render: () => h(component, props) })
  app.mount(root)
  return root
}

function paletteElement() {
  const element = document.createElement('div')
  element.style.setProperty('--prose-color-red', 'rgb(200, 0, 0)')
  element.style.setProperty('--prose-highlight-red', 'rgb(255, 220, 220)')
  document.body.append(element)
  return element
}

describe('colour swatches', () => {
  it('offers Default and the named palette, drawn from the editor palette variables', () => {
    const root = mount(CellColorSwatches, { editorElement: paletteElement() })
    const group = requireTestElement(root.querySelector('[role="group"]'), HTMLElement)
    const swatches = [...group.querySelectorAll('button')]

    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([...NAMES, ...LAST])
    expect(swatches.map((swatch) => swatch.title)).toEqual([...NAMES, ...LAST])
    expect(group.style.getPropertyValue('--prose-color-red')).toBe('rgb(200, 0, 0)')
    expect(group.style.getPropertyValue('--prose-highlight-red')).toBe('rgb(255, 220, 220)')
    expect(swatches[0].classList.contains('is-none')).toBe(true)
    expect(swatches[0].getAttribute('style')).toBe('border-color: var(--outline-gray-2);')
    expect(swatches[1].classList.contains('is-none')).toBe(false)
    expect(swatches[1].style.backgroundColor).toBe('var(--prose-highlight-red)')
    expect(swatches[1].style.borderColor).toBe(
      'color-mix(in srgb, var(--prose-color-red) 35%, transparent)',
    )
  })

  it('gives the colour panel a text and a background section with the same swatches', () => {
    const element = paletteElement()
    editor = new Editor({ element, extensions: [StarterKit], content: '<p>Hi</p>' })
    editor.view.dom.style.setProperty('--prose-color-blue', 'rgb(0, 0, 200)')
    const root = mount(ColorPanel, { editor })
    const panel = requireTestElement(root.firstElementChild, HTMLElement)
    const [text, background] = [...panel.children].map((element) =>
      requireTestElement(element, HTMLElement),
    )
    const textSwatches = [...text.querySelectorAll('.writer-swatch')].map((element) =>
      requireTestElement(element, HTMLElement),
    )
    const backgroundSwatches = [...background.querySelectorAll('.writer-swatch')].map((element) =>
      requireTestElement(element, HTMLElement),
    )

    expect(panel.style.getPropertyValue('--prose-color-blue')).toBe('rgb(0, 0, 200)')
    expect(text.textContent).toContain('Text color')
    expect(background.textContent).toContain('Background color')
    expect(textSwatches.map((swatch) => swatch.title)).toEqual([...NAMES, ...LAST])
    expect(textSwatches[0].textContent?.trim()).toBe('A')
    expect(textSwatches[0].style.color).toBe('var(--ink-gray-9)')
    expect(textSwatches[0].style.borderColor).toBe('var(--outline-gray-2)')
    expect(textSwatches[1].style.color).toBe('var(--prose-color-red)')
    expect(textSwatches[1].style.borderColor).toBe(
      'color-mix(in srgb, var(--prose-color-red) 35%, transparent)',
    )
    expect(backgroundSwatches[0].textContent?.trim()).toBe('')
    expect(backgroundSwatches[0].getAttribute('style')).toBe('border-color: var(--outline-gray-2);')
    expect(backgroundSwatches[1].style.backgroundColor).toBe('var(--prose-highlight-red)')
    expect(backgroundSwatches.map((swatch) => swatch.getAttribute('aria-pressed'))).toEqual([
      'true',
      ...Array(11).fill('false'),
    ])
  })
})
