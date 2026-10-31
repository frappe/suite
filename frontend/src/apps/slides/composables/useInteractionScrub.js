import { inCropMode } from '@/apps/slides/stores/imageCrop'
import { commitInteraction, interactionOffset } from '@/apps/slides/stores/interaction'
import { selectionBounds } from '@/apps/slides/stores/slide'

export const useInteractionScrub = (properties, onBegin, options = {}) => {
  let startBounds = null

  const applyValue = (property, value) => {
    selectionBounds[property] = value
    if (startBounds) interactionOffset[property] = value - startBounds[property]
  }

  const begin = () => {
    if (startBounds) return
    // the crop session owns interactionOffset; a keyboard scrub would
    // clobber it and commit without the crop
    if (inCropMode.value) return
    onBegin?.()
    startBounds = {}
    for (const property of properties) startBounds[property] = selectionBounds[property]
  }

  const preview = (property, value) => {
    if (inCropMode.value) return
    applyValue(property, value)
    if (!startBounds) return
    const linked = options.getLinkedValues?.(property, value, startBounds)
    if (linked) for (const key in linked) applyValue(key, linked[key])
  }

  const commit = () => {
    if (!startBounds) return
    startBounds = null
    commitInteraction()
  }

  return { begin, preview, commit }
}
