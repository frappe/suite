import type { Picker } from 'emoji-mart'

let preparation: Promise<typeof Picker | undefined> | undefined

export function prepareEmojiPicker(): Promise<typeof Picker | undefined> {
  preparation ??= Promise.all([
    import('emoji-mart'),
    import('@emoji-mart/data/sets/15/native.json'),
  ])
    .then(async ([{ Picker, init }, { default: data }]) => {
      await init({ data, set: 'native', emojiVersion: 15 })
      return Picker
    })
    .catch((error: unknown) => {
      preparation = undefined
      console.error('Failed to load the emoji picker', error)
      return undefined
    })
  return preparation
}
