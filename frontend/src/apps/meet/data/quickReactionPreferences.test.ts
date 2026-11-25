import { expect, it } from 'vitest'
import { nextTick } from 'vue'

it('adds a fourth slot to saved reactions and persists a swap', async () => {
  const key = 'meet.quickReactions'
  const original = ['🔥', '👍', '👀']
  localStorage.setItem(key, JSON.stringify(original))
  const { quickReactions, setQuickReaction } = await import('./quickReactionPreferences')

  expect(quickReactions.value).toEqual(['🔥', '👍', '👀', '🎉'])
  setQuickReaction(0, '👀')
  await nextTick()
  expect(quickReactions.value).toEqual(['👀', '👍', '🔥', '🎉'])
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(['👀', '👍', '🔥', '🎉'])

  localStorage.removeItem(key)
})
