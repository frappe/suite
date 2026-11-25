import { expect, it } from 'vitest'
import { nextTick } from 'vue'

it('restores saved reactions, swaps an already assigned emoji, and persists a reset', async () => {
  const key = 'meet.quickReactions'
  const original = ['🔥', '👍', '👀']
  localStorage.setItem(key, JSON.stringify(original))
  const { quickReactions, resetQuickReactions, setQuickReaction } =
    await import('./quickReactionPreferences')

  expect(quickReactions.value).toEqual(original)
  setQuickReaction(0, '👀')
  await nextTick()
  expect(quickReactions.value).toEqual(['👀', '👍', '🔥'])
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(['👀', '👍', '🔥'])

  resetQuickReactions()
  await nextTick()
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(['👍', '❤️', '😂'])

  localStorage.removeItem(key)
})
