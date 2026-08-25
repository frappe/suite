import { slides, slideIndex, currentSlide } from '@/apps/slides/stores/slide'
import { generateUniqueId } from '@/apps/slides/utils/helpers'
import { ZWSP } from '@/apps/slides/stores/tiptapSetup'
import { editElementCommand, editSlideCommand } from './commands'

// a blank line carries a ZWSP placeholder only once something has edited it, so
// comparing it would stop two identical lines from pairing
const blockText = (block) => block.textContent.replaceAll(ZWSP, '')

const canCreateTextConnection = (currentContent, nextContent) => {
	const parser = new DOMParser()

	const doc = parser.parseFromString(currentContent, 'text/html')
	const nextDoc = parser.parseFromString(nextContent, 'text/html')

	const currentBlocks = doc.body.children
	const nextBlocks = nextDoc.body.children

	if (currentBlocks.length != nextBlocks.length) return false

	for (let i = 0; i < currentBlocks.length; i++) {
		// within each block, compare text content only (ignore styles and tags)
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

	// update refs till magic move series ends on both sides
	commands = commands.concat(getCommandsForRefIdSeries(index, currElement, refId, false) || [])
	commands = commands.concat(getCommandsForRefIdSeries(index, currElement, refId, true) || [])

	return commands
}

const getCommandsToAddMagicMove = (index) => {
	// adding magic move to last slide changes nothing
	if (index == slides.value.length - 1) return

	let commands = []

	const currentSlide = slides.value[index]
	const currSlideId = currentSlide.clientId
	const nextSlide = slides.value[index + 1]
	const nextSlideId = nextSlide.clientId

	currentSlide.elements.forEach((currElement) => {
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
	// removing magic move from last slide changes nothing
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
	// TODO: add refId handling for shape elements
	if (element.type == 'shape') return []
	if (element.type == 'table') return []
	const commands = []
	const needsUpdate = isAffectedByMagicMove(index)
	if (!needsUpdate) return commands

	const { el, onPrev } = getReferenceElement(element, index)
	if (el) {
		const refId = generateUniqueId()

		// command to set refId on the element in the current slide
		commands.push(
			editElementCommand({
				slideId: slides.value[index].clientId,
				elementIds: [element.id],
				property: 'refId',
				oldValue: element.refId ?? null,
				newValue: refId,
			}),
		)

		// command to set refId on the reference element (prev/next slide)
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

		// update refs till magic move series ends on both sides
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

// a table's columns are pinned in pixels, so it cannot follow a frame that tweens.
// Without a refId it cuts with the slide instead of half-morphing
const getCommandsToInitElementRefId = (newElement, src, srcSlide) => {
	const commands = []
	if (newElement.type == 'table') return commands

	const index = slideIndex.value

	// only init refs when src is adjacent (prev or next)
	if (srcSlide !== index - 1 && srcSlide !== index + 1) return commands

	const srcElement = slides.value[srcSlide].elements.find((el) => el.id == src.id)
	if (!srcElement) return commands

	if (isSrcElementConnected(srcElement) || !isSrcSlideInMagicMove(srcSlide)) return commands

	const refId = generateUniqueId()

	const currentSlideObj = slides.value[index]
	const srcSlideObj = slides.value[srcSlide]

	// command to set refId on the new element (current slide)
	commands.push(
		editElementCommand({
			slideId: currentSlideObj.clientId,
			elementIds: [newElement.id],
			property: 'refId',
			oldValue: newElement.refId ?? null,
			newValue: refId,
		}),
	)

	// command to set refId on the source element (src slide)
	commands.push(
		editElementCommand({
			slideId: srcSlideObj.clientId,
			elementIds: [srcElement.id],
			property: 'refId',
			oldValue: srcElement.refId ?? null,
			newValue: refId,
		}),
	)

	// gather global ref id commands in both directions
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
	const commands = [
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
	]

	if (transition == 'Magic Move') {
		commands.push(...(getCommandsToAddMagicMove(index) || []))
	} else {
		commands.push(...(getCommandsToRemoveMagicMove(index) || []))
	}

	return commands
}

// elements sharing a key across slides get one reused node, which is what magic move
// tweens. A table keeps its own id so it cuts with the slide, refId or not
const getTransitionKey = (element) =>
	element.type == 'table' ? element.id : element.refId || element.id

export {
	getTransitionKey,
	isAffectedByMagicMove,
	getCommandsToAddMagicMove,
	getCommandsToRemoveMagicMove,
	getCommandsToSetTransition,
	getCommandsToInitElementRefId,
	getCommandsToUpdateElementRefId,
}
