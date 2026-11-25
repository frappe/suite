import { currentSlide, slideIndex, slides } from '@/apps/slides/stores/slide'
import { ZWSP } from '@/apps/slides/stores/tiptapSetup'
import { generateUniqueId } from '@/apps/slides/utils/helpers'
import { transitionKey as getTransitionKey } from '@/apps/slides/utils/transitionKey'

import { editElementCommand, editSlideCommand } from './commands'

const blockText = (block) => block.textContent.replaceAll(ZWSP, '')

const canCreateTextConnection = (currentContent, nextContent) => {
  const parser = new DOMParser()

  const doc = parser.parseFromString(currentContent, 'text/html')
  const nextDoc = parser.parseFromString(nextContent, 'text/html')

  const currentBlocks = doc.body.children
  const nextBlocks = nextDoc.body.children

  if (currentBlocks.length != nextBlocks.length) return false

  for (let i = 0; i < currentBlocks.length; i++) {
    if (blockText(currentBlocks[i]) != blockText(nextBlocks[i])) {
      return false
    }
  }

  return true
}

const canCreateMediaConnection = (currentSrc, nextSrc) => {
  return currentSrc == nextSrc
}

const canCreateConnection = (currElement, potentialConnectionElement) => {
  if (currElement.type == 'text') {
    return canCreateTextConnection(currElement.content, potentialConnectionElement.content)
  }
  return canCreateMediaConnection(currElement.src, potentialConnectionElement.src)
}

const getReferenceElementOnSlide = (slide, currElement) => {
  if (!slide) return null

  for (const element of slide.elements) {
    if (element.type != currElement.type) continue

    if (canCreateConnection(currElement, element)) {
      return element
    }
  }
}

const getReferenceElement = (element, index) => {
  const prevSlide = slides.value[index - 1]
  const nextSlide = slides.value[index + 1]

  let el = getReferenceElementOnSlide(prevSlide, element)
  let onPrev = true

  if (!el && slides.value[index]?.transition === 'Magic Move') {
    el = getReferenceElementOnSlide(nextSlide, element)
    onPrev = false
  }

  return { el, onPrev }
}

const getConnectionCommands = (currSlideId, nextSlideId, currElement, refElement, index) => {
  if (!refElement) return []

  const refId = generateUniqueId()
  let commands = [
    editElementCommand({
      slideId: currSlideId,
      elementIds: [currElement.id],
      property: 'refId',
      oldValue: currElement.refId,
      newValue: refId,
    }),
    editElementCommand({
      slideId: nextSlideId,
      elementIds: [refElement.id],
      property: 'refId',
      oldValue: refElement.refId,
      newValue: refId,
    }),
  ]

  commands = commands.concat(getCommandsForRefIdSeries(index, currElement, refId, false) || [])
  commands = commands.concat(getCommandsForRefIdSeries(index, currElement, refId, true) || [])

  return commands
}

const getCommandsToAddMagicMove = (index) => {
  if (index == slides.value.length - 1) return

  let commands = []

  const currentSlide = slides.value[index]
  const currSlideId = currentSlide.clientId
  const nextSlide = slides.value[index + 1]
  const nextSlideId = nextSlide.clientId

  currentSlide.elements.forEach((currElement) => {
    if (currElement.refId && nextSlide.elements.some((el) => el.refId == currElement.refId)) return
    const refElement = getReferenceElementOnSlide(nextSlide, currElement)
    commands = commands.concat(
      getConnectionCommands(currSlideId, nextSlideId, currElement, refElement, index),
    )
  })

  return commands
}

const getCommandToClearRefId = (slide, elementId, oldValue) => {
  return editElementCommand({
    slideId: slide.clientId,
    elementIds: [elementId],
    property: 'refId',
    oldValue: oldValue,
    newValue: null,
  })
}

const getCommandsToRemoveMagicMove = (index) => {
  if (index == slides.value.length - 1) return

  const commands = []

  const prevSlide = slides.value[index - 1]
  const currentSlide = slides.value[index]

  currentSlide.elements.forEach((currElement) => {
    const refId = currElement.refId
    if (!refId) return

    const refIdPresentInPrev = prevSlide?.elements.some((el) => el.refId == refId)
    if (refIdPresentInPrev) return

    commands.push(getCommandToClearRefId(currentSlide, currElement.id, refId))
  })

  return commands
}

const isAffectedByMagicMove = (slideIndex) => {
  const prevSlide = slides.value[slideIndex - 1]
  const currentSlide = slides.value[slideIndex]

  return prevSlide?.transition === 'Magic Move' || currentSlide?.transition === 'Magic Move'
}

const getCommandsToUpdateElementRefId = (element, index = slideIndex.value) => {
  if (element.type == 'shape') return []
  if (element.type == 'table') return []
  const commands = []
  const needsUpdate = isAffectedByMagicMove(index)
  if (!needsUpdate) return commands

  const { el, onPrev } = getReferenceElement(element, index)
  if (el) {
    const refId = generateUniqueId()

    commands.push(
      editElementCommand({
        slideId: slides.value[index].clientId,
        elementIds: [element.id],
        property: 'refId',
        oldValue: element.refId ?? null,
        newValue: refId,
      }),
    )

    const refSlideIndex = onPrev ? index - 1 : index + 1
    const refSlideObj = slides.value[refSlideIndex]
    if (refSlideObj) {
      commands.push(
        editElementCommand({
          slideId: refSlideObj.clientId,
          elementIds: [el.id],
          property: 'refId',
          oldValue: el.refId ?? null,
          newValue: refId,
        }),
      )
    }

    const forwardCommands = getCommandsForRefIdSeries(index, element, refId, onPrev)
    const backwardCommands = getCommandsForRefIdSeries(index, element, refId, !onPrev)

    if (forwardCommands && forwardCommands.length) commands.push(...forwardCommands)
    if (backwardCommands && backwardCommands.length) commands.push(...backwardCommands)
  } else {
    commands.push(getCommandToClearRefId(slides.value[index], element.id, element.refId))
  }

  return commands
}

const isSrcElementConnected = (srcElement) => {
  const refIdToCheck = srcElement?.refId
  if (!refIdToCheck) return false

  return currentSlide.value?.elements?.some((el) => el.refId == refIdToCheck) || false
}

const isSrcSlideInMagicMove = (srcSlide) => {
  const prevSlideIndex = slideIndex.value - 1

  return srcSlide === prevSlideIndex
    ? slides.value[prevSlideIndex]?.transition === 'Magic Move'
    : currentSlide.value?.transition === 'Magic Move'
}

const getCommandsToInitElementRefId = (newElement, src, srcSlide) => {
  const commands = []
  if (newElement.type == 'table') return commands

  const index = slideIndex.value

  if (srcSlide !== index - 1 && srcSlide !== index + 1) return commands

  const srcElement = slides.value[srcSlide].elements.find((el) => el.id == src.id)
  if (!srcElement) return commands

  if (isSrcElementConnected(srcElement) || !isSrcSlideInMagicMove(srcSlide)) return commands

  const refId = generateUniqueId()

  const currentSlideObj = slides.value[index]
  const srcSlideObj = slides.value[srcSlide]

  commands.push(
    editElementCommand({
      slideId: currentSlideObj.clientId,
      elementIds: [newElement.id],
      property: 'refId',
      oldValue: newElement.refId ?? null,
      newValue: refId,
    }),
  )

  commands.push(
    editElementCommand({
      slideId: srcSlideObj.clientId,
      elementIds: [srcElement.id],
      property: 'refId',
      oldValue: srcElement.refId ?? null,
      newValue: refId,
    }),
  )

  const isForward = srcSlide < index
  const forwardCommands = getCommandsForRefIdSeries(index, newElement, refId, isForward)
  const backwardCommands = getCommandsForRefIdSeries(index, newElement, refId, !isForward)

  if (forwardCommands && forwardCommands.length) commands.push(...forwardCommands)
  if (backwardCommands && backwardCommands.length) commands.push(...backwardCommands)

  return commands
}

const getCommandsForRefIdSeries = (fromSlideIndex, element, refId, isForward) => {
  let i = isForward ? fromSlideIndex + 1 : fromSlideIndex - 1
  const commands = []

  while (i >= 0 && i < slides.value.length) {
    const slide = slides.value[i]
    const transition = isForward ? slides.value[i - 1]?.transition : slide.transition
    const hasTransition = transition === 'Magic Move'

    if (!hasTransition) break

    const refElement = getReferenceElementOnSlide(slide, element)
    if (refElement) {
      commands.push(
        editElementCommand({
          slideId: slide.clientId,
          elementIds: [refElement.id],
          property: 'refId',
          oldValue: refElement.refId,
          newValue: refId,
        }),
      )
    }

    i += isForward ? 1 : -1
  }

  return commands
}

const getCommandsToSetTransition = (slide, index, settings) => {
  const { transition, transitionDuration, fadeUnmatchedElements } = settings
  const commands = []
  if (
    slide.transition != transition ||
    slide.transitionDuration != transitionDuration ||
    slide.fadeUnmatchedElements != fadeUnmatchedElements
  ) {
    commands.push(
      editSlideCommand({
        slideId: slide.clientId,
        property: 'transition',
        oldValue: slide.transition,
        newValue: transition,
      }),
      editSlideCommand({
        slideId: slide.clientId,
        property: 'transitionDuration',
        oldValue: slide.transitionDuration,
        newValue: transitionDuration,
      }),
      editSlideCommand({
        slideId: slide.clientId,
        property: 'fadeUnmatchedElements',
        oldValue: slide.fadeUnmatchedElements,
        newValue: fadeUnmatchedElements,
      }),
    )
  }

  if (transition == 'Magic Move') {
    commands.push(...(getCommandsToAddMagicMove(index) || []))
  } else {
    commands.push(...(getCommandsToRemoveMagicMove(index) || []))
  }

  return commands
}

export {
  getTransitionKey,
  isAffectedByMagicMove,
  getCommandsToSetTransition,
  getCommandsToInitElementRefId,
  getCommandsToUpdateElementRefId,
}
