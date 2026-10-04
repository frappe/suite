import { adoptLegacyDrafts } from '@/apps/slides/utils/drafts'
import { RECORD_PREFIX, USER_CACHE_NAMES } from '@/apps/slides/utils/slidesCaches'

// a broken worker must not hold up navigation
const ACK_TIMEOUT = 500

// the worker decides asset ownership per client, so the page has to say when it
// is slides; resolves once the worker has recorded that, or on the timeout
export const postToServiceWorker = (message: string): Promise<void> => {
  const controller = navigator.serviceWorker?.controller
  if (!controller) return Promise.resolve()
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(resolve, ACK_TIMEOUT)
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      resolve()
    }
    controller.postMessage(message, [channel.port2])
  })
}

// localStorage: the user whose slides data this browser holds; it outlives a
// logout, so the next user in can be told apart from the same one coming back
const CACHES_USER_KEY = 'slides-caches-user'

export const clearSlidesUserData = async () => {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(RECORD_PREFIX))
    .forEach((k) => localStorage.removeItem(k))
  if (!('caches' in window)) return
  await Promise.all(USER_CACHE_NAMES.map((name) => caches.delete(name)))
}

let draftsAdopted = false

// the caches are per origin, the data in them is per user; drafts are kept per
// user, so another user arriving never touches them
export const claimSlidesCachesFor = async (user: string) => {
  const previous = localStorage.getItem(CACHES_USER_KEY)
  if (!draftsAdopted) {
    draftsAdopted = true
    await adoptLegacyDrafts(previous).catch(() => {})
  }
  if (previous === user) return
  await clearSlidesUserData()
  localStorage.setItem(CACHES_USER_KEY, user)
}
