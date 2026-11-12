import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useListFilter } from './listFilter'

const filterFor = (offer: { starrable?: boolean; screenable?: boolean } = {}) => {
  const onChange = vi.fn()
  const filter = useListFilter({
    onChange,
    starrable: () => offer.starrable ?? true,
    screenable: () => offer.screenable ?? false,
  })
  const tick = (label: string) => {
    const option = filter.FILTER_OPTIONS.value.find((o) => o.label === label)!
    const event = new Event('select', { cancelable: true })
    option.onClick(event)
    return event
  }
  return { ...filter, onChange, tick }
}

describe('useListFilter', () => {
  beforeEach(() => {
    vi.stubGlobal('__', (text: string, args: string[] = []) =>
      text.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? ''),
    )
  })

  it('shows everything with nothing ticked', () => {
    const { filter, filterTitle } = filterFor()
    expect(filter.value).toBeNull()
    expect(filterTitle.value).toBe('All mail')
  })

  it('combines ticked filters, in menu order, as a filtered list', () => {
    const { filter, filterTitle, tick } = filterFor()
    tick('Starred')
    tick('Unread')
    expect(filter.value).toBe('unread,starred')
    expect(filterTitle.value).toBe('Unread +1')
  })

  it('unticks a filter on a second tick, and refetches each time', () => {
    const { filter, filterTitle, tick, onChange } = filterFor()
    tick('Unread')
    tick('Unread')
    expect(filter.value).toBeNull()
    expect(filterTitle.value).toBe('All mail')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('keeps the menu open while ticking', () => {
    const { tick } = filterFor()
    expect(tick('Unread').defaultPrevented).toBe(true)
  })

  it('leaves out a filter this list does not offer', () => {
    const { filter, tick, FILTER_OPTIONS } = filterFor({ starrable: false })
    tick('Starred')
    expect(filter.value).toBeNull()
    expect(FILTER_OPTIONS.value.find((o) => o.label === 'Starred')?.condition?.()).toBe(false)
  })

  it('names one ticked filter as the menu does', () => {
    const { filterTitle, tick } = filterFor()
    tick('Has attachments')
    expect(filterTitle.value).toBe('Has attachments')
  })

  it('remembers nothing: another list starts clear', () => {
    const first = filterFor()
    first.tick('Unread')
    expect(filterFor().filter.value).toBeNull()
    first.reloadFilter()
    expect(first.filter.value).toBeNull()
  })
})
