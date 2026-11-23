import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import EmailListInput from './EmailListInput.vue'

vi.mock('@/platform/translation', () => ({
  translate: (text: string, args: unknown[] = []) =>
    text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])),
}))

let app: App | undefined
let root: HTMLDivElement
afterEach(() => {
  app?.unmount()
  root.remove()
})

function mount(initial: string[] = []) {
  const addresses = ref<string[]>(initial)
  const draft = ref('')
  root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () =>
      h(EmailListInput, {
        label: 'Recipients',
        modelValue: addresses.value,
        'onUpdate:modelValue': (value: string[]) => (addresses.value = value),
        draft: draft.value,
        'onUpdate:draft': (value: string) => (draft.value = value),
      }),
  })
  app.mount(root)
  const input = root.querySelector('input')!
  return { addresses, draft, input }
}

async function type(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

function paste(input: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  input.dispatchEvent(event)
}

const chips = () => [...root.querySelectorAll('span[class*="rounded-4 border"]')]

describe('EmailListInput', () => {
  it('splits a pasted list on commas, spaces and line breaks, once per address', async () => {
    const { addresses, input } = mount(['theo@northwind.test'])
    paste(input, 'ana@northwind.test, sales@partner.example\ntheo@northwind.test')
    await nextTick()
    expect(addresses.value).toEqual([
      'theo@northwind.test',
      'ana@northwind.test',
      'sales@partner.example',
    ])
    expect(chips()).toHaveLength(3)
  })

  it('turns the typed address into a chip on Enter and on leaving the field', async () => {
    const { addresses, draft, input } = mount()
    await type(input, 'ana@northwind.test')
    expect(draft.value).toBe('ana@northwind.test')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    await nextTick()
    expect(addresses.value).toEqual(['ana@northwind.test'])
    expect(draft.value).toBe('')

    await type(input, 'theo@northwind.test')
    input.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(addresses.value).toEqual(['ana@northwind.test', 'theo@northwind.test'])
  })

  it('marks an entry that is not an email address and says how many need fixing', async () => {
    const { input } = mount()
    paste(input, 'ana@northwind.test theo')
    await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'One entry is not an email address',
    )
    const flagged = chips().filter((chip) => chip.getAttribute('title'))
    expect(flagged.map((chip) => chip.textContent?.trim())).toEqual(['theo'])
  })

  it('removes the last chip on Backspace in an empty field, and a chip by its button', async () => {
    const { addresses, input } = mount(['ana@northwind.test', 'theo@northwind.test', 'x@y.test'])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))
    await nextTick()
    expect(addresses.value).toEqual(['ana@northwind.test', 'theo@northwind.test'])
    root.querySelector<HTMLButtonElement>('[aria-label="Remove ana@northwind.test"]')!.click()
    await nextTick()
    expect(addresses.value).toEqual(['theo@northwind.test'])
  })
})
