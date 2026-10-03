// Single reactive breakpoint every area shares, so the shell chrome and each
// area's own header agree on when to switch from the desktop layout to the
// mobile one.
import { useMediaQuery } from '@vueuse/core'

export const isMobile = useMediaQuery('(max-width: 767px)')
