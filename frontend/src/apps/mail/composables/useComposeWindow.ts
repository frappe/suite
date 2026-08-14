import { ref, watch, type Ref } from 'vue'

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

/**
 * Ties a composer's `show` to the window: opening claims it and closes whoever held it, and
 * closing releases it. Call once per SendMail instance, from setup.
 */
export const claimComposeWindow = (show: Ref<boolean | undefined>, onRestore?: () => void) => {
	const id = Symbol('compose-window')

	watch(show, (open) => {
		if (open) {
			holder.value = id
			unfold = onRestore ?? null
		} else if (holder.value === id) {
			holder.value = null
			unfold = null
		}
	})

	// Someone else claimed it while this one was open.
	watch(holder, (current) => {
		if (show.value && current !== id) show.value = false
	})
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
