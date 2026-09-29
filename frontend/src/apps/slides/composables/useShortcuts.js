import { ref, onMounted, onUnmounted } from 'vue'
import { useKeyboardShortcut } from 'frappe-ui'

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
	startTextEditing,
	focusElementId,
	addTextElement,
	pendingShapeType,
	pendingShapePreset,
	selectAllElements,
	activeElementIds,
	activeElements,
	deleteElements,
	duplicateElements,
	isSelectionLocked,
	isTextSelection,
	toggleLock,
} from '@/apps/slides/stores/element'
import {
	changeSlideInSlideshow,
	startSlideShow,
	performNextStep,
	performPreviousStep,
} from '@/apps/slides/stores/slideshow'

import { interactionOffset, commitInteraction } from '@/apps/slides/stores/interaction'
import { inCropMode, commitCrop, cancelCrop } from '@/apps/slides/stores/imageCrop'

const { toggleNavigationPanel } = useNavigationPanel()
const { activeEditor, toggleMark } = useTextEditor()

export const showShortcutsModal = ref(false)

export const useShortcuts = (inReadonlyMode, inSlideShowMode) => {
	const inEditMode = () => !inReadonlyMode.value && !inSlideShowMode.value && !inCropMode.value
	const inReadonly = () => inReadonlyMode.value && !inSlideShowMode.value
	const inSlideShow = () => inSlideShowMode.value
	const hasElements = () => activeElementIds.value.length > 0
	const hasActiveTextEditor = () =>
		hasElements() && (!!activeEditor.value || isTextSelection.value)

	const nudge = (key, step = 1) => {
		if (isSelectionLocked.value) return

		let dx = 0
		let dy = 0

		if (key == 'ArrowLeft') dx = -step
		else if (key == 'ArrowRight') dx = step
		else if (key == 'ArrowUp') dy = -step
		else if (key == 'ArrowDown') dy = step

		interactionOffset.left = dx
		interactionOffset.top = dy
		commitInteraction()

		updateSelectionBounds({
			left: selectionBounds.left + dx,
			top: selectionBounds.top + dy,
		})
	}

	const isPlainInput = (e) => {
		const target = e?.target
		return (
			target &&
			!target.isContentEditable &&
			(target.tagName == 'INPUT' || target.tagName == 'TEXTAREA')
		)
	}

	// every editable field except the slide editor keeps its own text undo. this
	// has to gate the shortcut rather than its handler: a matched shortcut is
	// preventDefaulted before the handler runs, which would kill the native undo too
	const ownsNativeUndo = () => {
		const target = document.activeElement
		if (!target || target.closest('.ProseMirror')) return false
		return (
			target.isContentEditable ||
			target.tagName == 'INPUT' ||
			target.tagName == 'TEXTAREA'
		)
	}

	// only keyboard focus: a clicked button keeps focus while the canvas is in use
	const isControlFocused = () =>
		!!document.querySelector(':is(button, a[href], [role="button"]):focus-visible')

	const performHistory = (e, operation) => {
		// an undo mid-composition destroys the IME node
		if (e.isComposing || activeEditor.value?.view.composing) return

		if (operation == 'undo') commandHistory.undo()
		else commandHistory.redo()
	}

	const handleBold = (e) => {
		if (inEditMode() && hasActiveTextEditor()) {
			if (!isSelectionLocked.value) toggleMark('bold')
			return
		}
		if (inEditMode() || inReadonly()) toggleNavigationPanel(e)
	}

	const nudgeStep = (e) => (e?.shiftKey ? 10 : 1)

	const handleArrowUp = (e) => {
		if (isArrowNavActive()) return
		if (inSlideShow()) return performPreviousStep()
		if (inReadonly()) return changeSlide(slideIndex.value - 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowUp', nudgeStep(e))
		else changeEditorSlide(slideIndex.value - 1)
	}

	const handleArrowDown = (e) => {
		if (isArrowNavActive()) return
		if (inSlideShow()) return performNextStep()
		if (inReadonly()) return changeSlide(slideIndex.value + 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowDown', nudgeStep(e))
		else changeEditorSlide(slideIndex.value + 1)
	}

	const handleArrowLeft = (e) => {
		if (isArrowNavActive()) return
		if (inSlideShow()) return performPreviousStep()
		if (inEditMode() && hasElements()) nudge('ArrowLeft', nudgeStep(e))
	}

	const handleArrowRight = (e) => {
		if (isArrowNavActive()) return
		if (inSlideShow()) return performNextStep()
		if (inEditMode() && hasElements()) nudge('ArrowRight', nudgeStep(e))
	}

	const deleteElementOrSlide = (e) => {
		if (hasElements()) deleteElements(e)
		else deleteSlide()
	}

	const addShape = (shapeType) => {
		pendingShapePreset.value = {}
		pendingShapeType.value = shapeType
	}

	// overlays dismiss on Escape only if the event wasn't defaultPrevented,
	// and matching a shortcut always prevents — so don't match while one is open
	const hasOpenOverlay = () =>
		!!document.querySelector('[data-dismissable-layer][data-state="open"]')

	// keys meant for an open list never reach the canvas behind it
	const skipInOverlay = (handler) => (e) => {
		if (!hasOpenOverlay()) handler(e)
	}

	// menus and radio groups like TabButtons move between options with the arrows
	const isArrowNavActive = () =>
		hasOpenOverlay() || !!document.activeElement?.closest('[role="radiogroup"]')

	const hasTextCapableSelection = () => {
		if (activeElements.value.length !== 1) return false
		const [element] = activeElements.value
		return element.type === 'text' || (element.type === 'shape' && element.shapeType !== 'line')
	}

	const canStartTextEditing = () =>
		inEditMode() &&
		hasTextCapableSelection() &&
		!focusElementId.value &&
		!isSelectionLocked.value &&
		!hasOpenOverlay()

	// capture phase, so single-letter tool shortcuts don't fire over an editable selection
	const handleTypeToEdit = (e) => {
		if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
		if (e.key === '?') return
		if (e.key === ' ' && isControlFocused()) return
		if (isPlainInput(e) || e.target?.isContentEditable) return
		if (!canStartTextEditing()) return
		e.preventDefault()
		e.stopPropagation()
		startTextEditing(e.key)
	}

	onMounted(() => window.addEventListener('keydown', handleTypeToEdit, true))
	onUnmounted(() => window.removeEventListener('keydown', handleTypeToEdit, true))

	const handleEscape = (e) => {
		if (isPlainInput(e)) return e.target.blur()
		if (focusElementId.value) return exitTextEditing()
		if (e.target?.isContentEditable) return e.target.blur()
		resetFocus()
	}

	const shortcuts = [
		{
			combo: 'Shift+Slash',
			description: 'Show keyboard shortcuts',
			group: 'General',
			allowInDialog: true,
			handler: () => (showShortcutsModal.value = true),
		},
		{
			combo: 'Mod+B',
			description: 'Toggle navigation panel',
			group: 'General',
			handler: handleBold,
		},
		{
			combo: 'Mod+S',
			description: 'Save',
			group: 'General',
			enabled: inEditMode,
			handler: (e) => saveSlide(e),
		},
		{
			combo: 'Mod+Z',
			description: 'Undo',
			group: 'General',
			allowInInput: true,
			enabled: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'undo'),
		},
		{
			combo: 'Mod+Y',
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			enabled: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'redo'),
		},
		{
			combo: 'Mod+Shift+Z',
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			enabled: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'redo'),
		},

		{
			combo: 'Enter',
			description: 'Edit text of selected element',
			group: 'Edit',
			enabled: () => canStartTextEditing() && !isControlFocused(),
			handler: () => startTextEditing(),
		},
		{
			combo: 'Enter',
			description: 'Add slide below',
			group: 'Insert',
			enabled: () =>
				inEditMode() && !canStartTextEditing() && !hasOpenOverlay() && !isControlFocused(),
			handler: (e) => addEmptySlide(e),
		},
		{
			combo: 'T',
			description: 'Add text box',
			group: 'Insert',
			enabled: inEditMode,
			handler: skipInOverlay(() => addTextElement()),
		},
		{
			combo: 'R',
			description: 'Add rectangle',
			group: 'Insert',
			enabled: inEditMode,
			handler: skipInOverlay(() => addShape('rectangle')),
		},
		{
			combo: 'O',
			description: 'Add oval',
			group: 'Insert',
			enabled: inEditMode,
			handler: skipInOverlay(() => addShape('oval')),
		},
		{
			combo: 'L',
			description: 'Add line',
			group: 'Insert',
			enabled: inEditMode,
			handler: skipInOverlay(() => addShape('line')),
		},
		{
			combo: 'C',
			description: 'Add connector',
			group: 'Insert',
			enabled: inEditMode,
			handler: skipInOverlay(() => addShape('connector')),
		},
		{
			combo: 'Mod+A',
			description: 'Select all elements',
			group: 'Edit',
			enabled: inEditMode,
			handler: (e) => selectAllElements(e),
		},
		{
			combo: 'Escape',
			description: 'Deselect',
			group: 'Edit',
			allowInInput: true,
			enabled: () => inEditMode() && !hasOpenOverlay(),
			handler: handleEscape,
		},
		{
			combo: 'Escape',
			description: 'Exit crop mode',
			group: 'Edit',
			allowInInput: true,
			enabled: () => inCropMode.value && !hasOpenOverlay(),
			handler: () => cancelCrop(),
		},
		{
			combo: 'Enter',
			description: 'Apply crop',
			group: 'Edit',
			allowInInput: true,
			enabled: () => inCropMode.value && !hasOpenOverlay() && !isControlFocused(),
			handler: () => commitCrop(),
		},
		{
			combo: 'Mod+D',
			description: 'Duplicate element / slide',
			group: 'Edit',
			enabled: inEditMode,
			handler: (e) => {
				if (hasElements()) duplicateElements(e, activeElements.value)
				else duplicateSlide()
			},
		},
		{
			combo: 'Delete',
			description: 'Delete element / slide',
			group: 'Edit',
			enabled: inEditMode,
			handler: skipInOverlay(deleteElementOrSlide),
		},
		{
			combo: 'Backspace',
			description: 'Delete element / slide',
			group: 'Edit',
			enabled: inEditMode,
			handler: skipInOverlay(deleteElementOrSlide),
		},
		{
			combo: 'Mod+Shift+L',
			description: 'Lock or unlock element',
			group: 'Edit',
			allowInInput: true,
			enabled: inEditMode,
			handler: (e) => {
				if (isPlainInput(e)) return
				toggleLock()
			},
		},
		{
			combo: 'ArrowUp',
			description: 'Move element',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowUp,
		},
		{
			combo: 'ArrowDown',
			description: 'Move element',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowDown,
		},
		{
			combo: 'ArrowLeft',
			description: 'Move element',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowLeft,
		},
		{
			combo: 'ArrowRight',
			description: 'Move element',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowRight,
		},
		{
			combo: 'Shift+ArrowUp',
			description: 'Move element by 10px',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowUp,
		},
		{
			combo: 'Shift+ArrowDown',
			description: 'Move element by 10px',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowDown,
		},
		{
			combo: 'Shift+ArrowLeft',
			description: 'Move element by 10px',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowLeft,
		},
		{
			combo: 'Shift+ArrowRight',
			description: 'Move element by 10px',
			group: 'Edit',
			enabled: inEditMode,
			handler: handleArrowRight,
		},
		{
			combo: 'ArrowUp',
			description: 'Change slide',
			group: 'Edit',
			handler: handleArrowUp,
		},
		{
			combo: 'ArrowDown',
			description: 'Change slide',
			group: 'Edit',
			handler: handleArrowDown,
		},

		{
			combo: 'Mod+B',
			description: 'Bold',
			group: 'Format Text',
			enabled: inEditMode,
			handler: handleBold,
		},
		{
			combo: 'Mod+I',
			description: 'Italic',
			group: 'Format Text',
			enabled: inEditMode,
			handler: () => {
				if (hasActiveTextEditor() && !isSelectionLocked.value) toggleMark('italic')
			},
		},
		{
			combo: 'Mod+U',
			description: 'Underline',
			group: 'Format Text',
			enabled: inEditMode,
			handler: () => {
				if (hasActiveTextEditor() && !isSelectionLocked.value) toggleMark('underline')
			},
		},

		{
			combo: 'Mod+P',
			description: 'Start',
			group: 'Slideshow',
			handler: () => {
				if (inEditMode() || inReadonly()) startSlideShow()
			},
		},
		{
			combo: 'F5',
			description: 'Restart',
			group: 'Slideshow',
			enabled: inSlideShow,
			handler: () => changeSlideInSlideshow(0),
		},
		{
			combo: 'ArrowLeft',
			description: 'Previous step',
			group: 'Slideshow',
			handler: handleArrowLeft,
		},
		{
			combo: 'PageUp',
			description: 'Previous step',
			group: 'Slideshow',
			handler: () => {
				if (inSlideShow()) performPreviousStep()
			},
		},
		{
			combo: 'Space',
			description: 'Next step',
			group: 'Slideshow',
			enabled: inSlideShow,
			handler: () => performNextStep(),
		},
		{
			combo: 'ArrowRight',
			description: 'Next step',
			group: 'Slideshow',
			handler: handleArrowRight,
		},
		{
			combo: 'PageDown',
			description: 'Next step',
			group: 'Slideshow',
			handler: () => {
				if (inSlideShow()) performNextStep()
			},
		},
	]

	useKeyboardShortcut(shortcuts)
}
