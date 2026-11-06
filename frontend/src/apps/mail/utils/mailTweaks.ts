import { reactive } from 'vue'

/**
 * Look-and-feel choices still open. The values here are what ships: MailTweakPanel, which changes
 * them to compare the alternatives, only exists in a dev build (see MailLayout).
 */
export const mailTweaks = reactive({
  /** How a pinned row reads: under a Pinned header, by its icon alone, or tinted. */
  pinLook: 'section' as 'section' | 'icon' | 'tint',
  /** How a row back from waiting is marked: a word, or just a bell. */
  returnedLook: 'badge' as 'badge' | 'bell',
  /** Where the composer offers a reminder if nobody replies: its own button, or under Send. */
  remindEntry: 'toolbar' as 'toolbar' | 'send-menu',
})
