import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * One composer window at a time.
 *
 * `SendMail` is mounted in three places — the layout's global composer, the list header, and a
 * draft popped out of a thread — and each owns its own visibility. While they were all modal that
 * was invisible: two dialogs simply stacked. Docked, they land in the same corner and overlap.
 *
 * So whichever composer opens last holds the window, and the previous one closes.
 *
 * Several docked composers side by side is the other half of #407 and deliberately not built yet;
 * when it is, this is the file that stops being a guard and starts being a list.
 */
const holder = ref<symbol | null>(null)
let unfold: (() => void) | null = null

const release = (id: symbol) => {
	if (holder.value !== id) return
	holder.value = null
	unfold = null
}

/**
 * Ties a composer's `show` to the window: opening claims it and closes whoever held it, and
 * closing — or unmounting — releases it. Call once per SendMail instance, from setup.
 */
export const claimComposeWindow = (show: Ref<boolean | undefined>, onRestore?: () => void) => {
	const id = Symbol('compose-window')

	watch(
		show,
		(open) => {
			if (open) {
				holder.value = id
				unfold = onRestore ?? null
			} else release(id)
		},
		// Immediate, because a composer routinely mounts already open: DefaultLayout bumps its key
		// and sets `show` in the same tick so a second request replaces the draft on screen, and a
		// draft popped out of a thread flips a v-if the same way. On change alone, neither would
		// ever claim the window — leaving two composers in one corner, and a Compose that finds no
		// holder to bring back.
		{ immediate: true },
	)

	watch(holder, (current) => {
		if (show.value && current !== id) show.value = false
	})

	// Unmounting while open has to release too, or the window is held by a component that no
	// longer exists: Compose would report it handled the request and hand it to a dead closure.
	// Scope disposal rather than onUnmounted so this is exercisable without mounting anything.
	onScopeDispose(() => release(id))
}

/**
 * What Compose should do when a composer is already open: bring that one back rather than start a
 * second. Minimised, it is folded into the corner and a new one would close it — taking the draft
 * with it — which is the opposite of what pressing Compose meant.
 *
 * Returns true when it handled the request, so the caller opens nothing.
 */
export const restoreComposeWindow = () => {
	if (!holder.value) return false
	unfold?.()
	return true
}
