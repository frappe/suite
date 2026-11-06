import { ref } from 'vue'

/**
 * Where a composer shows its save state. Awaiting a decision at review: the dev-only Tweak panel
 * (ComposeSaveTweak) flips between these, and a production build stays on the default.
 *
 * - `toolbar`: at the end of the bottom bar, by Discard. On a phone, under the page's title.
 * - `title`: in the composer window's title bar. A reply in a thread has none, so stays on the bar.
 *   On a phone, in place of the page's title.
 * - `send`: right beside Send. On a phone, in the header by the Send icon.
 */
export type DraftSavePlacement = 'toolbar' | 'title' | 'send'

export const draftSavePlacement = ref<DraftSavePlacement>('toolbar')
