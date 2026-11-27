import { useMediaQuery } from '@vueuse/core'

/**
 * Whether the window is phone width: below 768px, where the shell lays out for a phone. One query
 * for the shell and what it draws (an area's sidebar), so they switch in the same update. With a
 * query each they switched one after the other, in the order their modules loaded, and a sidebar
 * moved into the desktop layout before the shell had drawn it.
 */
export const isPhoneWidth = useMediaQuery('(max-width: 767px)')
