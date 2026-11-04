// Whether the app rail is pinned, and whether it is currently peeking out
// over the content. Module scope, so the rail's own toggle and the shell's
// hover zone read the same refs.
import { ref } from 'vue'

/** Pinned: the rail holds a column of its own and pushes the content across. */
export const sidebarOpen = ref(true)

/** Unpinned but showing, because the pointer is at the window's left edge. */
export const railPeek = ref(false)
