import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type PropType } from 'vue'

import { translationPlugin } from '@/platform/translation'

import BookingPage from './BookingPage.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  // The zone picker as a native select: its popover is frappe-ui's to test.
  Combobox: defineComponent({
    props: {
      modelValue: String,
      label: String,
      // SAFETY: the page passes `{ value, label }` options, as frappe-ui's Combobox takes them.
      options: { type: Array as PropType<{ value: string; label: string }[]>, default: () => [] },
    },
    emits: ['update:modelValue'],
    setup: (props, { emit }) => {
      return () =>
        h('label', [
          props.label,
          h(
            'select',
            {
              value: props.modelValue,
              onChange: (event: Event) =>
                event.target instanceof HTMLSelectElement &&
                emit('update:modelValue', event.target.value),
            },
            props.options.map((option) => h('option', { value: option.value }, option.label)),
          ),
        ])
    },
  }),
}))

/**
 * The guest endpoints as the contract states them: a page by slug, and its free slot starts
 * (UTC) inside the asked window, none at or after `bookable_until`. A slug the server does not
 * know answers as a missing page.
 */
const server = vi.hoisted(() => {
  const pages = new Map<string, { slots: string[]; bookable_until: string }>()
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const address = new URL(String(url), 'http://suite.test')
    const match = address.pathname.match(
      /^\/api\/suite\/calendar\/booking-pages\/([^/]+)(\/slots)?$/,
    )
    const page = match && pages.get(decodeURIComponent(match[1]))
    if (!match || !page)
      return new Response(
        JSON.stringify({ errors: [{ type: 'DoesNotExistError', message: 'Not found' }] }),
        { status: 404 },
      )
    const data = match[2]
      ? {
          slots: page.slots.filter((slot) => {
            const at = Date.parse(slot)
            return (
              at >= Date.parse(address.searchParams.get('from')!) &&
              at < Date.parse(address.searchParams.get('to')!) &&
              at < Date.parse(page.bookable_until)
            )
          }),
          bookable_until: page.bookable_until,
        }
      : {
          slug: match[1],
          title: 'Onboarding call',
          description: null,
          length_minutes: 30,
          hosts: [{ full_name: 'Sam Host', user_image: null }],
        }
    return new Response(JSON.stringify({ data }))
  }
  return { pages }
})

let cleanup: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T06:00:00Z'))
})

afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Opens the page as a booker whose browser is in `zone`. */
function open(slug: string, zone: string) {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolved.call(this), timeZone: zone }
  })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(BookingPage, { slug }) })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

const day = (root: HTMLElement, label: string) => {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`No day ${label}`)
  return button
}

const freeTimes = (root: HTMLElement) =>
  [...root.querySelectorAll('[aria-label="Free times"] button')].map((button) =>
    button.textContent!.replace(/\s/g, ' ').trim(),
  )

describe('booking page', () => {
  it('puts each slot on the day it falls on in the booker’s zone, and moves it with the zone', async () => {
    server.pages.set('zones', {
      // 09:00 on 24 Nov in Kolkata, 19:30 on 23 Nov in Los Angeles.
      // 01:30 on 25 Nov in Kolkata, 12:00 on 24 Nov in Los Angeles.
      slots: ['2026-11-24T03:30:00Z', '2026-11-24T20:00:00Z'],
      bookable_until: '2026-12-20T00:00:00Z',
    })
    const root = open('zones', 'Asia/Kolkata')

    await vi.waitFor(() => expect(day(root, 'Tuesday, November 24').disabled).toBe(false))
    expect(day(root, 'Wednesday, November 25').disabled).toBe(false)
    expect(day(root, 'Monday, November 23').disabled).toBe(true)
    expect(freeTimes(root)).toEqual(['9:00 AM'])
    day(root, 'Wednesday, November 25').click()
    await vi.waitFor(() => expect(freeTimes(root)).toEqual(['1:30 AM']))

    const zone = root.querySelector('select')!
    zone.value = 'America/Los_Angeles'
    zone.dispatchEvent(new Event('change'))

    await vi.waitFor(() => expect(day(root, 'Monday, November 23').disabled).toBe(false))
    expect(day(root, 'Wednesday, November 25').disabled).toBe(true)
    day(root, 'Monday, November 23').click()
    await vi.waitFor(() => expect(freeTimes(root)).toEqual(['7:30 PM']))
    day(root, 'Tuesday, November 24').click()
    await vi.waitFor(() => expect(freeTimes(root)).toEqual(['12:00 PM']))
  })

  it('lets no day without a free slot be picked, nor a month past the last bookable day', async () => {
    server.pages.set('short', {
      slots: ['2026-11-23T04:30:00Z', '2026-11-27T04:30:00Z', '2026-11-28T04:30:00Z'],
      // The end of 28 Nov in Kolkata.
      bookable_until: '2026-11-28T18:30:00Z',
    })
    const root = open('short', 'Asia/Kolkata')

    await vi.waitFor(() => expect(day(root, 'Monday, November 23').disabled).toBe(false))
    expect(day(root, 'Friday, November 27').disabled).toBe(false)
    expect(day(root, 'Saturday, November 28').disabled).toBe(false)
    for (const label of ['Tuesday, November 24', 'Sunday, November 29', 'Monday, November 30'])
      expect(day(root, label).disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.disabled).toBe(
      true,
    )
  })

  it('says a page the server does not know does not exist', async () => {
    const root = open('switched-off', 'Asia/Kolkata')

    await vi.waitFor(() => expect(root.textContent).toContain('This booking page does not exist'))
    expect(root.querySelector('[aria-label="Free times"]')).toBeNull()
  })
})
