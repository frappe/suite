import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import type { PeopleGetOutput } from '@/platform/transport/generated'

import type { PickedPerson } from './shareModel'
import SharePicker from './SharePicker.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Combobox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Select')),
}))

const directoryRequest = vi.hoisted(() =>
  vi
    .fn<(operation: unknown, input?: { q?: string }) => Promise<PeopleGetOutput>>()
    .mockResolvedValue({ rows: [], next_cursor: null }),
)
vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: { request: directoryRequest },
}))

const directory: PeopleGetOutput = {
  rows: [
    {
      kind: 'user',
      name: 'maya@example.com',
      email: 'maya@example.com',
      full_name: 'Maya Fernandes',
      user_image: null,
    },
    {
      kind: 'user',
      name: 'leah@example.com',
      email: 'leah@example.com',
      full_name: 'Leah Thomas',
      user_image: null,
    },
  ],
  next_cursor: null,
}
beforeEach(() => directoryRequest.mockReset().mockResolvedValue(directory))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())
// jsdom has no scrolling; the list scrolls the highlighted row into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  return () => delete (Element.prototype as Partial<Element>).scrollIntoView
})

function mountPicker(
  share: (
    people: PickedPerson[],
    role: number,
    notify: boolean,
  ) => Promise<PickedPerson[]> = async () => [],
) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(SharePicker, { nodeKind: 'file', share }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root.querySelector<HTMLInputElement>('input[aria-label="Add people, groups or emails"]')!
}

async function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return vi.waitFor(() => {
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.length).toBeGreaterThan(0)
    return options
  })
}

/** A pointer pick: the browser moves focus to the row before the click lands. */
function clickRow(options: HTMLElement[], label: string) {
  const row = options.find((option) => option.textContent?.includes(label))!
  row.tabIndex = -1
  row.focus()
  row.click()
}

const staged = () =>
  [...document.querySelectorAll('[aria-label="People to add"] li')].map((item) =>
    item.querySelector('p')?.textContent?.trim(),
  )

describe('Share picker', () => {
  it('keeps suggestions open and search focused for consecutive picks, revealing access after the first pick', async () => {
    const input = mountPicker()

    expect(document.querySelector('[aria-label="Access for people you add"]')).toBeNull()
    clickRow(await type(input, 'ma'), 'Maya Fernandes')
    await vi.waitFor(() => {
      expect(staged()).toEqual(['Maya Fernandes'])
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(document.querySelector('[aria-label="Access for people you add"]')).not.toBeNull()
      expect(
        [...document.querySelectorAll('[role="option"]')].some((option) =>
          option.textContent?.includes('Maya Fernandes'),
        ),
      ).toBe(false)
    })

    clickRow(await type(input, 'le'), 'Leah Thomas')
    await vi.waitFor(() => expect(staged()).toEqual(['Maya Fernandes', 'Leah Thomas']))
    expect(document.activeElement).toBe(input)
  })
  it('shares selected recipients with notification off, retaining only failed recipients', async () => {
    const share = vi.fn(async (people: PickedPerson[]) =>
      people.filter((person) => person.principal === 'leah@example.com'),
    )
    const input = mountPicker(share)
    clickRow(await type(input, 'ma'), 'Maya Fernandes')
    await vi.waitFor(() => expect(staged()).toEqual(['Maya Fernandes']))
    clickRow(await type(input, 'le'), 'Leah Thomas')
    await vi.waitFor(() => expect(staged()).toEqual(['Maya Fernandes', 'Leah Thomas']))

    const notify = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(notify.checked).toBe(true)
    notify.click()
    const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Share',
    )!
    submit.click()

    await vi.waitFor(() => expect(staged()).toEqual(['Leah Thomas']))
    expect(share).toHaveBeenCalledWith(
      [
        {
          principal: 'maya@example.com',
          kind: 'user',
          label: 'Maya Fernandes',
          name: 'Maya Fernandes',
        },
        { principal: 'leah@example.com', kind: 'user', label: 'Leah Thomas', name: 'Leah Thomas' },
      ],
      10,
      false,
    )
    document.querySelector<HTMLButtonElement>('[aria-label="Remove Leah Thomas"]')!.click()
    await vi.waitFor(() => expect(staged()).toEqual([]))
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(document.querySelector('[aria-label="Access for people you add"]')).toBeNull()
  })
  it('keeps visible results during search and ignores a response after the query changes', async () => {
    let finishOld: ((page: PeopleGetOutput) => void) | undefined
    let finishLatest: ((page: PeopleGetOutput) => void) | undefined
    directoryRequest.mockImplementation(async (_operation, input) => {
      if (input?.q === 'older')
        return new Promise((resolve) => {
          finishOld = resolve
        })
      if (input?.q === 'latest')
        return new Promise((resolve) => {
          finishLatest = resolve
        })
      return directory
    })
    const input = mountPicker()
    await type(input, 'ma')
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(2))
    await type(input, 'older')
    await vi.waitFor(() => expect(finishOld).toBeDefined())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)

    // Resolve the old request before the next debounced request starts.
    await type(input, 'latest')
    finishOld?.({ rows: [], next_cursor: null })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    await vi.waitFor(() => expect(finishLatest).toBeDefined())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    finishLatest?.({ rows: directory.rows.slice(1), next_cursor: null })
    await vi.waitFor(() => {
      const options = document.querySelectorAll('[role="option"]')
      expect(options).toHaveLength(1)
      expect(options[0]?.textContent).toContain('Leah Thomas')
    })
  })
})
