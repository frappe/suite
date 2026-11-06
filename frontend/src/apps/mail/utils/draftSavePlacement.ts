import { ref } from 'vue'

/**
 * Where a composer shows its save state. Awaiting a decision at review: the dev-only Tweak panel
 * (ComposeSaveTweak) flips between these, and a production build stays on the default.
 *
 * - `title` (default): in the composer window's title bar, which has room to spare, so the bottom
 *   bar keeps every button. A reply in a thread has no title bar, so it stays on its bar.
 *   On a phone, under the page's title.
 * - `toolbar`: at the end of the bottom bar, by Discard. On a phone, under the page's title.
 * - `send`: right beside Send. On a phone, in the header by the Send icon.
 */
export type DraftSavePlacement = 'toolbar' | 'title' | 'send'

export const draftSavePlacement = ref<DraftSavePlacement>('title')
