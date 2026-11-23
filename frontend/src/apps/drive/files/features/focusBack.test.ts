import { afterEach, describe, expect, it } from 'vitest'

import { waitForFocusBack } from './focusBack'

afterEach(() => document.body.replaceChildren())

// A menu item that, as reka's does, picks on Enter by clicking itself inside the keydown
function menuItem(pick: () => void) {
  const item = document.createElement('button')
  item.addEventListener('click', pick)
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      item.click()
    }
  })
  document.body.append(item)
  return item
}

describe('an action waiting for focus to come back', () => {
  it('runs once after a mouse pick, past the pointerup that ends it', () => {
    const focusBack = waitForFocusBack()
    const calls: string[] = []
    const item = menuItem(() => focusBack.wait(() => calls.push('saved')))

    item.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    item.dispatchEvent(new Event('pointerup', { bubbles: true }))
    item.click()
    focusBack.focused()
    focusBack.focused()

    expect(calls).toEqual(['saved'])
  })

  it('runs once after an Enter pick, past the keydown that picked it', () => {
    const focusBack = waitForFocusBack()
    const calls: string[] = []
    const item = menuItem(() => focusBack.wait(() => calls.push('saved')))

    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    focusBack.focused()
    focusBack.focused()

    expect(calls).toEqual(['saved'])
  })

  it('drops the action on a click or a key elsewhere before focus comes back', () => {
    const focusBack = waitForFocusBack()
    const calls: string[] = []

    focusBack.wait(() => calls.push('clicked'))
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    focusBack.focused()
    focusBack.wait(() => calls.push('typed'))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    focusBack.focused()

    expect(calls).toEqual([])
  })

  it('runs only the latest action, and a later input drops nothing after it ran', () => {
    const focusBack = waitForFocusBack()
    const calls: string[] = []

    focusBack.wait(() => calls.push('first'))
    focusBack.wait(() => calls.push('second'))
    focusBack.focused()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    focusBack.wait(() => calls.push('third'))
    focusBack.focused()

    expect(calls).toEqual(['second', 'third'])
  })
})
