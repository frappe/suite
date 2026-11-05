import { reactive } from 'vue'

/**
 * Look-and-feel choices still open. The values here are what ships: MailTweakPanel, which changes
 * them to compare the alternatives, only exists in a dev build (see MailLayout).
 */
export const mailTweaks = reactive({
  /** How a pinned row reads: under a Pinned header, by its icon alone, or tinted. */
  pinLook: 'section' as 'section' | 'icon' | 'tint',
})
