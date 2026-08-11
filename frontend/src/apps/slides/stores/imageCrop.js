import { computed, ref } from 'vue'

import { toast } from 'frappe-ui'

import {
	activeElement,
	ensureExplicitHeight,
	getNaturalAspectRatio,
	pendingShapeType,
} from './element'
import { currentSlide, slides } from './slide'
import { commitInteraction, resetInteractionOffset } from './interaction'
import { commandHistory } from './historyMeta'
import { batchCommand, editElementCommand } from './commands'
import { getBorderInset, getCoverCrop, isFullRect } from '../utils/cropGeometry'
import { getAttachmentUrl } from '../utils/mediaUploads'

const cropElementId = ref(null)
const draftCrop = ref(null)
const initialCrop = ref(null)

const inCropMode = computed(() => cropElementId.value != null)

const cropElement = computed(() =>
	currentSlide.value?.elements.find((el) => el.id == cropElementId.value),
)

const probeNaturalAspect = async (element) => {
	try {
		return await getNaturalAspectRatio(getAttachmentUrl(element.src))
	} catch {
		toast.error('Failed to load the image.')
	}
}

const startCrop = async (element) => {
	if (!element || element.type != 'image' || element.locked) return

	ensureExplicitHeight(element)
	// without a height the frame-aspect math below is NaN
	if (!element.height) return

	// a primed shape draw must not arm through the mode
	pendingShapeType.value = null

	let crop = element.crop
	if (!crop) {
		// an uncropped image renders object-cover, so seed the draft from that
		// rect: for a placeholder it differs from the full rect, and nothing jumps
		const inset = getBorderInset(element)
		const frameAspect = (element.width - 2 * inset) / (element.height - 2 * inset)
		const naturalAspect = await probeNaturalAspect(element)
		if (naturalAspect == null) return
		// the load may outlive a deletion, slide switch, or selection change
		if (activeElement.value?.id != element.id) return
		crop = getCoverCrop(naturalAspect, frameAspect)
	}

	draftCrop.value = { ...crop }
	initialCrop.value = { ...crop }
	cropElementId.value = element.id
}

const cancelCrop = () => {
	// drop the session's uncommitted frame offset; out of mode it belongs to a normal drag
	if (inCropMode.value) resetInteractionOffset()

	cropElementId.value = null
	draftCrop.value = null
	initialCrop.value = null
}

const cropsEqual = (a, b) => {
	if (!a || !b) return !a && !b
	return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height
}

const commitCrop = () => {
	const element = cropElement.value
	if (!element) return cancelCrop()

	// a full rect commits as absent: that is the canonical uncropped state
	const newCrop = isFullRect(draftCrop.value) ? undefined : draftCrop.value

	// an untouched session must not add a do-nothing undo step
	if (cropsEqual(draftCrop.value, initialCrop.value)) return cancelCrop()
	if (cropsEqual(element.crop, newCrop)) return cancelCrop()

	const command = editElementCommand({
		slideId: currentSlide.value.clientId,
		elementIds: [element.id],
		property: 'crop',
		oldValue: element.crop,
		newValue: newCrop,
	})

	commitInteraction([command])
	cancelCrop()
}

// clear the crop and give the frame back its natural aspect, in one undo step
const resetImageCrop = async (element) => {
	if (!element?.crop) return

	const naturalAspect = await probeNaturalAspect(element)
	if (naturalAspect == null) return

	// the load may outlive a slide switch or the element itself
	const slide = slides.value.find((s) => s.elements.some((el) => el.id == element.id))
	if (!slide) return

	const inset = getBorderInset(element)
	const newHeight = (element.width - 2 * inset) / naturalAspect + 2 * inset

	const slideId = slide.clientId
	const commands = [
		editElementCommand({
			slideId,
			elementIds: [element.id],
			property: 'crop',
			oldValue: element.crop,
			newValue: undefined,
		}),
		editElementCommand({
			slideId,
			elementIds: [element.id],
			property: 'height',
			oldValue: element.height,
			newValue: newHeight,
		}),
	]

	commandHistory.execute(batchCommand({ slideId, elementIds: [element.id], commands }))
}

export {
	inCropMode,
	cropElement,
	draftCrop,
	startCrop,
	commitCrop,
	cancelCrop,
	resetImageCrop,
}
