import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { createResource } from 'frappe-ui'

export const getSessionUser = (): string | null => {
  const cookies = new URLSearchParams(document.cookie.split('; ').join('&'))
  let user = cookies.get('user_id')
  if (user === 'Guest') user = null
  return user
}

const _getCookies = () =>
  Object.fromEntries(
    document.cookie
      .split('; ')
      .map((c) => {
        const [k, ...v] = c.split('=')
        return [k, decodeURIComponent(v.join('='))]
      }),
  )

const _cookies = _getCookies()

/** Cookie-based profile refs — synchronous on load, updated when userResource resolves. */
export const fullName = ref(_cookies.full_name || '')
export const imageURL = ref(_cookies.user_image || '')
export const systemUser = ref(_cookies.system_user === 'yes')
export const jmapUser = ref(false)

export const userResource = createResource({
  url: 'suite.api.account.get_logged_in_user',
  cache: 'User',
  onError(error) {
    if (error && error.exc_type === 'AuthenticationError') {
      window.location.href = '/login'
    }
  },
  onSuccess(data: Record<string, unknown> | null) {
    if (!data) return
    if (data.full_name) fullName.value = data.full_name as string
    if (data.avatar) imageURL.value = data.avatar as string
    systemUser.value = ((data.roles as string[]) ?? []).includes('System Manager')
    jmapUser.value = !!data.is_jmap_configured
  },
})

/**
 * Shared suite session store.
 *
 * One source of truth for "who is logged in" across all 7 apps. Reads the
 * `user_id` cookie set by the Frappe backend; `Guest` is treated as logged-out.
 * Per-app session stores should be replaced by (or delegate to) this one so the
 * unified shell and every app route group agree on auth state.
 */
export const useSessionStore = defineStore('suite-session', () => {
  const user = ref<string | null>(getSessionUser())
  const isLoggedIn = computed(() => !!user.value)

  const login = createResource({
    url: 'login',
    onError() {
      throw new Error('Invalid email or password')
    },
    onSuccess() {
      user.value = getSessionUser()
      login.reset()
    },
  })

  const logout = createResource({
    url: 'logout',
    onSuccess() {
      user.value = null
      window.location.reload()
    },
  })

  return { user, isLoggedIn, login, logout }
})

export const session = reactive({
  user: computed(() => {
    const store = useSessionStore()
    return {
      sessionUser: store.user,
      ...userResource.data,
    }
  }),
  isLoggedIn: computed(() => useSessionStore().isLoggedIn),
})

export function useCurrentUser() {
  const store = useSessionStore()
  return {
    user: computed(() => store.user),
    isLoggedIn: computed(() => store.isLoggedIn),
    fullName: computed(() => (userResource.data?.full_name as string | undefined) ?? fullName.value),
    imageURL: computed(() => (userResource.data?.avatar as string | undefined) ?? imageURL.value),
    systemUser: computed(() =>
      userResource.data
        ? ((userResource.data.roles as string[]) ?? []).includes('System Manager')
        : systemUser.value,
    ),
    jmapUser: computed(() => (userResource.data ? !!userResource.data.is_jmap_configured : jmapUser.value)),
  }
}
