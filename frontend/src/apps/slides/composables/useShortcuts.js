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
	const hasActiveTextEditor = () => hasElements() && !!activeEditor.value

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
		if (inSlideShow()) return performPreviousStep()
		if (inReadonly()) return changeSlide(slideIndex.value - 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowUp', nudgeStep(e))
		else changeEditorSlide(slideIndex.value - 1)
	}

	const handleArrowDown = (e) => {
		if (inSlideShow()) return performNextStep()
		if (inReadonly()) return changeSlide(slideIndex.value + 1)
		if (!inEditMode()) return
		if (hasElements()) nudge('ArrowDown', nudgeStep(e))
		else changeEditorSlide(slideIndex.value + 1)
	}

	const handleArrowLeft = (e) => {
		if (inSlideShow()) return performPreviousStep()
		if (inEditMode() && hasElements()) nudge('ArrowLeft', nudgeStep(e))
	}

	const handleArrowRight = (e) => {
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
			condition: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'undo'),
		},
		{
			key: 'y',
			ctrl: true,
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			condition: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'redo'),
		},
		{
			key: 'z',
			ctrl: true,
			shift: true,
			description: 'Redo',
			group: 'General',
			allowInInput: true,
			condition: () => inEditMode() && !ownsNativeUndo(),
			handler: (e) => performHistory(e, 'redo'),
		},

		{
			key: 'Enter',
			description: 'Edit text of selected element',
			group: 'Edit',
			condition: canStartTextEditing,
			handler: () => startTextEditing(),
		},
		{
			key: 'Enter',
			description: 'Add slide below',
			group: 'Insert',
			condition: () => inEditMode() && !canStartTextEditing(),
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
			key: 'c',
			description: 'Add connector',
			group: 'Insert',
			condition: inEditMode,
			handler: () => addShape('connector'),
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
			shift: true,
			description: 'Move element by 10px',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowUp,
		},
		{
			key: 'ArrowDown',
			shift: true,
			description: 'Move element by 10px',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowDown,
		},
		{
			key: 'ArrowLeft',
			shift: true,
			description: 'Move element by 10px',
			group: 'Edit',
			condition: inEditMode,
			handler: handleArrowLeft,
		},
		{
			key: 'ArrowRight',
			shift: true,
			description: 'Move element by 10px',
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
	]

	useKeyboardShortcut(
		shortcuts.map(({ key, ctrl, shift, condition, ...shortcut }) => ({
			...shortcut,
			combo:
				key === '?'
					? 'Shift+Slash'
					: [ctrl && 'Mod', shift && 'Shift', key === ' ' ? 'Space' : key]
							.filter(Boolean)
							.join('+'),
			enabled: condition,
		})),
	)
}
