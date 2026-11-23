import { ref } from 'vue'

// A thread whose messages changed by a hand other than its pane's: the phone's compose page, which
// sends and undoes from a page of its own, with the thread it came from off screen. The request is
// held until that thread's pane takes it — on the phone the pane mounts again only once the compose
// page has gone back to it — and the pane rebuilds from fresh rows. Any other pane leaves it.
const threadReloadRequest = ref<{ threadId: string }>()
export const useThreadReload = () => ({
  threadReloadRequest,
  requestThreadReload: (threadId: string) => (threadReloadRequest.value = { threadId }),
})
