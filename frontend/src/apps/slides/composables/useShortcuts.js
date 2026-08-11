import { ref } from 'vue'
import { useShortcut } from 'frappe-ui'

import { useNavigationPanel } from '@/apps/slides/composables/useNavigationPanel'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

import {
	slideIndex,
	changeSlide,
	saveSlide,
	selectionBounds,
	updateSelectionBounds,
	deleteSlide,
	changeEditorSlide,
	duplicateSlide,
	addEmptySlide,
} from '@/apps/slides/stores/slide'
import {
	resetFocus,
	exitTextEditing,
	focusElementId,
	addTextElement,
	pendingShapeType,
	selectAllElements,
	activeElementIds,
	activeElements,
	deleteElements,
	duplicateElements,
	activeElement,
	isSelectionLocked,
	toggleLock,
} from '@/apps/slides/stores/element'
import {
	changeSlideInSlideshow,
	startSlideShow,
	performNextStep,
	performPreviousStep,
} from '@/apps/slides/stores/slideshow'

import { markDirty } from '@/apps/slides/stores/saving'
import { inCropMode, commitCrop, cancelCrop } from '@/apps/slides/stores/imageCrop'

const { toggleNavigationPanel } = useNavigationPanel()
const { activeEditor, toggleMark } = useTextEditor()

export const showShortcutsModal = ref(false)

export const useShortcuts = (inReadonlyMode, inSlideShowMode) => {
	const inEditMode = () => !inReadonlyMode.value && !inSlideShowMode.value && !inCropMode.value
	const inReadonly = () => inReadonlyMode.value && !inSlideShowMode.value
	const inSlideShow = () => inSlideShowMode.value
	const hasElements = () => activeElementIds.value.length > 0
	const hasActiveTextEditor = () => hasElements() && !!activeEditor.value

	const nudge = (key) => {
		if (isSelectionLocked.value) return

		let dx = 0
		let dy = 0

		if (key == 'ArrowLeft') dx = -1
		else if (key == 'ArrowRight') dx = 1
		else if (key == 'ArrowUp') dy = -1
		else if (key == 'ArrowDown') dy = 1

		updateSelectionBounds({
			left: selectionBounds.left + dx,
			top: selectionBounds.top + dy,
		})

		activeElements.value.forEach((element) => {
			element.left += dx
			element.top += dy
		})

		markDirty()
	}

	const isEditorFocused = () => activeEditor.value?.isEditable

	const isPlainInput = (e) => {
		const target = e?.target
		return (
			target &&
			!target.isContentEditable &&
			(target.tagName == 'INPUT' || target.tagName == 'TEXTAREA')
		)
	}

	const performHistory = (operation) => {
		if (isEditorFocused()) {
			if (operation == 'undo' && !activeEditor.value?.can().undo()) {
				commandHistory.undo()
			} else if (operation == 'redo' && !activeEditor.value?.can().redo()) {
				commandHistory.redo()
			}
			return
		}

		if (
			activeEditor.value?.can()[operation]() &&
			activeElement.value?.type == 'text' &&
			!isSelectionLocked.value
		) {
			activeEditor.value.commands[operation]()
			return
		}

		if (operation == 'undo' && commandHistory.canUndo.value) {
			if (activeElement.value?.type == 'text') activeElementIds.value = []
			commandHistory.undo()
		} else if (operation == 'redo' && commandHistory.canRedo.value) {
			if (activeElement.value?.type == 'text') activeElementIds.value = []
			commandHistory.redo()
		}
	}

	const handleBold = (e) => {
		if (inEditMode() && hasActiveTextEditor()) {
			if (!isSelectionLocked.value) toggleMark('bold')
			return
		}
		if (inEditMode() || inReadonly()) toggleNavigationPanel(e)
	}

	const handleArrowUp = () => {
		if (inSlideShow()) return performPreviousStep()
		if (inReadonly()) return changeSlide(slideIndex.value - 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowUp')
		else changeEditorSlide(slideIndex.value - 1)
	}

	const handleArrowDown = () => {
		if (inSlideShow()) return performNextStep()
		if (inReadonly()) return changeSlide(slideIndex.value + 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowDown')
		else changeEditorSlide(slideIndex.value + 1)
	}

	const handleArrowLeft = () => {
		if (inSlideShow()) return performPreviousStep()
		if (inEditMode() && hasElements()) nudge('ArrowLeft')
	}

	const handleArrowRight = () => {
		if (inSlideShow()) return performNextStep()
		if (inEditMode() && hasElements()) nudge('ArrowRight')
	}

	const deleteElementOrSlide = (e) => {
		if (hasElements()) deleteElements(e)
		else deleteSlide()
	}

	const addShape = (shapeType) => {
		pendingShapeType.value = shapeType
	}

	// overlays dismiss on Escape only if the event wasn't defaultPrevented,
	// and matching a shortcut always prevents — so don't match while one is open
	const hasOpenOverlay = () =>
		!!document.querySelector('[data-dismissable-layer][data-state="open"]')

	const handleEscape = (e) => {
		if (isPlainInput(e)) return e.target.blur()
		if (focusElementId.value) return exitTextEditing()
		if (e.target?.isContentEditable) return e.target.blur()
		resetFocus()
	}

	useShortcut([
		{
			key: '?',
			description: 'Show keyboard shortcuts',
			group: 'General',
			allowInDialog: true,
			handler: () => (showShortcutsModal.value = true),
		},
		{
			key: 'b',
			ctrl: true,
			description: 'Toggle navigation panel',
			group: 'General',
			handler: handleBold,
		},
		{
			key: 's',
			ctrl: true,
			description: 'Save',
			group: 'General',
			condition: inEditMode,
			handler: (e) => saveSlide(e),
		},
		{
			key: 'z',
			ctrl: true,
			description: 'Undo',
			group: 'General',
			allowInInput: true,
			condition: inEditMode,
			handler: (e) => {
				if (isPlainInput(e)) return
				performHistory('undo')
			},
		},
		{
			key: 'y',
			ctrl: true,
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			condition: inEditMode,
			handler: (e) => {
				if (isPlainInput(e)) return
				performHistory('redo')
			},
		},
		{
			key: 'z',
			ctrl: true,
			shift: true,
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			condition: inEditMode,
			handler: (e) => {
				if (isPlainInput(e)) return
				performHistory('redo')
			},
		},

		{
			key: 'Enter',
			description: 'Add slide below',
			group: 'Insert',
			condition: inEditMode,
			handler: (e) => addEmptySlide(e),
		},
		{
			key: 't',
			description: 'Add text box',
			group: 'Insert',
			condition: inEditMode,
			handler: () => addTextElement(),
		},
		{
			key: 'r',
			description: 'Add rectangle',
			group: 'Insert',
			condition: inEditMode,
			handler: () => addShape('rectangle'),
		},
		{
			key: 'o',
			description: 'Add oval',
			group: 'Insert',
			condition: inEditMode,
			handler: () => addShape('oval'),
		},
		{
			key: 'l',
			description: 'Add line',
			group: 'Insert',
			condition: inEditMode,
			handler: () => addShape('line'),
		},
		{
			key: 'a',
			ctrl: true,
			description: 'Select all elements',
			group: 'Edit',
			condition: inEditMode,
			handler: (e) => selectAllElements(e),
		},
		{
			key: 'Escape',
			description: 'Deselect',
			group: 'Edit',
			allowInInput: true,
			condition: () => inEditMode() && !hasOpenOverlay(),
			handler: handleEscape,
		},
		{
			key: 'Escape',
			description: 'Exit crop mode',
			group: 'Edit',
			allowInInput: true,
			condition: () => inCropMode.value && !hasOpenOverlay(),
			handler: () => cancelCrop(),
		},
		{
			key: 'Enter',
			description: 'Apply crop',
			group: 'Edit',
			allowInInput: true,
			condition: () => inCropMode.value && !hasOpenOverlay(),
			handler: () => commitCrop(),
		},
		{
			key: 'd',
			ctrl: true,
			description: 'Duplicate element / slide',
			group: 'Edit',
			condition: inEditMode,
			handler: (e) => {
				if (hasElements()) duplicateElements(e, activeElements.value)
				else duplicateSlide()
			},
		},
		{
			key: 'Delete',
			description: 'Delete element / slide',
			group: 'Edit',
			condition: inEditMode,
			handler: deleteElementOrSlide,
		},
		{
			key: 'Backspace',
			description: 'Delete element / slide',
			group: 'Edit',
			condition: inEditMode,
			handler: deleteElementOrSlide,
		},
		{
			key: 'l',
			ctrl: true,
			shift: true,
			description: 'Lock or unlock element',
			group: 'Edit',
			allowInInput: true,
			condition: inEditMode,
			handler: (e) => {
				if (isPlainInput(e)) return
				toggleLock()
			},
		},
		{
			key: 'ArrowUp',
			description: 'Move element',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowUp,
		},
		{
			key: 'ArrowDown',
			description: 'Move element',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowDown,
		},
		{
			key: 'ArrowLeft',
			description: 'Move element',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowLeft,
		},
		{
			key: 'ArrowRight',
			description: 'Move element',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowRight,
		},
		{
			key: 'ArrowUp',
			description: 'Change slide',
			group: 'Edit',
			handler: handleArrowUp,
		},
		{
			key: 'ArrowDown',
			description: 'Change slide',
			group: 'Edit',
			handler: handleArrowDown,
		},

		{
			key: 'b',
			ctrl: true,
			description: 'Bold',
			group: 'Format Text',
			condition: inEditMode,
			handler: handleBold,
		},
		{
			key: 'i',
			ctrl: true,
			description: 'Italic',
			group: 'Format Text',
			condition: inEditMode,
			handler: () => {
				if (hasActiveTextEditor() && !isSelectionLocked.value) toggleMark('italic')
			},
		},
		{
			key: 'u',
			ctrl: true,
			description: 'Underline',
			group: 'Format Text',
			condition: inEditMode,
			handler: () => {
				if (hasActiveTextEditor() && !isSelectionLocked.value) toggleMark('underline')
			},
		},

		{
			key: 'p',
			ctrl: true,
			description: 'Start',
			group: 'Slideshow',
			handler: () => {
				if (inEditMode() || inReadonly()) startSlideShow()
			},
		},
		{
			key: 'F5',
			description: 'Restart',
			group: 'Slideshow',
			condition: inSlideShow,
			handler: () => changeSlideInSlideshow(0),
		},
		{
			key: 'ArrowLeft',
			description: 'Previous step',
			group: 'Slideshow',
			handler: handleArrowLeft,
		},
		{
			key: 'PageUp',
			description: 'Previous step',
			group: 'Slideshow',
			handler: () => {
				if (inSlideShow()) performPreviousStep()
			},
		},
		{
			key: ' ',
			description: 'Next step',
			group: 'Slideshow',
			handler: () => {
				if (inSlideShow()) performNextStep()
			},
		},
		{
			key: 'ArrowRight',
			description: 'Next step',
			group: 'Slideshow',
			handler: handleArrowRight,
		},
		{
			key: 'PageDown',
			description: 'Next step',
			group: 'Slideshow',
			handler: () => {
				if (inSlideShow()) performNextStep()
			},
		},
	])
}
