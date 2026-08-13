import { ref } from 'vue'

// Decided once, at load, and deliberately not reactive to resize. Mobile and desktop are
// separate component trees, not one tree restyled: crossing 640px mid-session swaps them and
// unmounts whatever they were holding — a half-written mail vanished this way (#38), and every
// other open surface has the same exposure. A resized window therefore keeps the layout it
// started with until the page is reloaded.
//
// Which is why this is for STRUCTURE — which tree to mount, which route to take — and not for
// sizing. Tailwind's `max-sm:` keys on the same 640px but follows the viewport live, so a
// component that sizes itself from this ref ends up disagreeing with the one next to it after a
// resize. The mobile steps live in src/index.css.
//
// Shared rather than per-app: mail owned the only copy, so the calendar had no way to ask and
// rendered its desktop event panel at every width. (meet still has its own in utils/device.ts.)
const isMobile = ref(window.innerWidth < 640)

export const useScreenSize = () => ({ isMobile })
