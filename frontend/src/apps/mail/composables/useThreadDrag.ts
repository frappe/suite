import { computed, h, ref, render } from 'vue'
import { FolderInput } from 'lucide-vue-next'

/**
 * Dragging threads onto a folder.
 *
 * The two halves of the gesture sit in different trees — the rows are in the
 * view, the folders in the sidebar beside it — so the dragged threads and the
 * move that answers a drop are held here rather than passed between them.
 *
 * The move itself is `handleMoveThreads` from useThreadActions, which the view
 * registers on mount: a drop is the same act as picking a folder from the
 * "Move to" menu, down to the undo snapshot, the Junk diversion and the toast.
 * Registering it rather than importing it keeps that logic bound to the view
 * that owns the list — the sidebar never needs to know what a move involves.
 */

/** Thread ids under the cursor for the length of one drag. */
const threadIds = ref<string[]>([])

/** The mailbox the cursor is over, so the sidebar can mark the row it would drop into. */
const overMailbox = ref('')

/**
 * What the cursor carries. Chrome's default is a snapshot of the row, which has
 * two faults: the list's scrollbar is an overlay sitting on the row's right edge,
 * so it gets painted into the picture, and a drag of ten selected threads looks
 * exactly like a drag of one. A chip naming the count says what is actually
 * moving, and owes nothing to what the row happened to look like.
 */
const setDragChip = (e: DragEvent, count: number) => {
	if (!e.dataTransfer) return

	const chip = document.createElement('div')
	// gray-1 on gray-10, the pairing used wherever this app puts ink on a dark
	// fill. `text-ink-white` is not a token — it generates nothing, and the chip
	// came out near-black text on a near-black fill. Medium weight because the
	// browser draws a drag image at reduced opacity, which thins it further.
	chip.className =
		'bg-surface-gray-10 text-ink-gray-1 rounded-4 flex items-center gap-1.5 py-1.5 pl-2.5 pr-3 text-sm font-medium shadow-lg'

	// The same icon the "Move to" menu is opened by, at the size that menu draws
	// it — a drop is that menu's act performed by hand, so it is worth looking
	// like it. Mounted through Vue rather than hand-written as an svg string so
	// the icon stays whatever lucide says it is; the app's `svg.lucide` rule
	// gives it stroke 1.5, and `currentColor` takes the chip's ink.
	const icon = document.createElement('span')
	icon.className = 'flex'
	render(h(FolderInput, { size: 16 }), icon)
	// lucide also stamps `lucide-folder-input`, which collides with a generated
	// icon utility of that exact name: 1em square, plus a mask that redraws the
	// same glyph over the svg. Elsewhere `.icon` pins the size so the collision
	// goes unseen, but `.icon` also fixes a colour this chip cannot use. Keeping
	// only `lucide` sizes the icon by its own attributes and drops the redraw.
	icon.firstElementChild?.setAttribute('class', 'lucide')

	// Names the act, not just the cargo: the chip appears the moment the drag starts,
	// before any folder is chosen, and "Moving" is what tells you the drop will move
	// rather than copy. "Thread" is the word the toast that follows uses.
	const label = document.createElement('span')
	label.textContent =
		count === 1 ? __('Moving 1 thread') : __('Moving {0} threads', [String(count)])

	chip.append(icon, label)
	// Rendered, but out of the way: setDragImage needs a laid-out element, and the
	// browser takes its picture before the frame this was added in is painted.
	chip.style.cssText += ';position:fixed;top:-1000px;left:-1000px;white-space:nowrap;'
	document.body.appendChild(chip)

	e.dataTransfer.setDragImage(chip, 12, 12)
	// A timer, not requestAnimationFrame: the browser takes the picture during this
	// event, so the next task is late enough to clean up — and rAF does not run at
	// all in a background tab, which left a chip in the body for every drag.
	setTimeout(() => {
		render(null, icon)
		chip.remove()
	})
}

type MoveHandler = (byMailbox: Record<string, string[]>) => void

let move: MoveHandler | null = null

export const useThreadDrag = () => ({
	threadIds,
	overMailbox,

	isDragging: computed(() => threadIds.value.length > 0),

	/** The view lends the sidebar its move; cleared when the view goes away. */
	setMoveHandler: (handler: MoveHandler | null) => {
		move = handler
	},

	start: (ids: string[], e?: DragEvent) => {
		threadIds.value = ids
		if (e) setDragChip(e, ids.length)
	},

	/**
	 * Ends the drag whether or not it landed. Both `dragend` on the row and
	 * `drop` on a folder fire, in that order for a successful drop, so this has
	 * to be safe to call twice.
	 */
	end: () => {
		threadIds.value = []
		overMailbox.value = ''
	},

	drop: (mailboxId: string) => {
		const ids = threadIds.value
		threadIds.value = []
		overMailbox.value = ''
		if (ids.length && move) move({ [mailboxId]: ids })
	},
})
