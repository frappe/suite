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
let dismiss: (() => void) | null = null
let heldDraft: (() => string | undefined) | null = null // the draft's server id

const release = (id: symbol) => {
	if (holder.value !== id) return
	holder.value = null
	dismiss = null
	heldDraft = null
}

/**
 * Ties a composer's `show` to the window: opening claims it and closes whoever held it, and
 * closing — or unmounting — releases it. Call once per SendMail instance, from setup.
 */
export const claimComposeWindow = (
	show: Ref<boolean | undefined>,
	draftId?: () => string | undefined,
) => {
	const id = Symbol('compose-window')

	watch(
		show,
		(open) => {
			if (open) {
				holder.value = id
				dismiss = () => (show.value = false)
				heldDraft = draftId ?? null
			} else release(id)
		},
		// Immediate, because a composer routinely mounts already open: Compose bumps its key and sets
		// `show` in the same tick so a second request replaces the draft on screen, and a draft
		// popped out of a thread flips a v-if the same way. On change alone, neither would ever
		// claim the window — leaving two composers in one corner, each unaware of the other.
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
 * The id of the draft the open composer window is holding, if it is holding one.
 *
 * The id, not the name: a save writes only `id` back onto the composer's draft (see
 * onMailUpdateSuccess), so a mail composed from scratch never learns its own name and matching on
 * that silently never fires.
 */
export const composeWindowDraft = () => heldDraft?.()

/**
 * Give up the window. For a host that is about to show the same draft itself — opening a draft
 * from the list puts it in the thread, and a copy left in the window would be a second editor on
 * one draft, each saving over the other.
 */
export const closeComposeWindow = () => {
	if (!holder.value) return false
	dismiss?.()
	return true
}

/**
 * Give up the window if what it is writing is one of these mails.
 *
 * For a list acting on the draft's own row — trashed, junked, deleted. Left alone the window goes on
 * writing a message the reader has just thrown away, autosaving it every couple of seconds: the row
 * is gone from the list and the draft is very much still being written. Closing saves what is in it,
 * which is right either way — for a move the text belongs with the mail wherever it has gone, and
 * for a delete it is the last thing that ever happens to it.
 */
export const closeComposeWindowFor = (mailIds: string[]) => {
	const held = composeWindowDraft()
	if (held && mailIds.includes(held)) closeComposeWindow()
}

/** Whether a composer window is on screen — docked or minimised, it floats over the app. */
export const isComposeWindowOpen = () => !!holder.value
