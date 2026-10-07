import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api, useQuery } from '@/api'
import router from '@/apps/mail/router'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { getSessionUser, useSessionStore } from '@/boot/session'
import { useSession } from '@/platform/session'

export const sessionStore = defineStore('mail-session', () => {
  const session = useSessionStore()
  const { loadUser, reset } = userStore()

  const platformSession = useSession()
  const isLoggingIn = ref(false)
  const loginError = ref<Error | null>(null)
  async function login(usr: string, pwd: string) {
    isLoggingIn.value = true
    loginError.value = null
    try {
      await platformSession.login(usr, pwd)
      reset()
      await loadUser()
      if (platformSession.user.value?.id === 'Administrator') window.location.replace('/app')
      else await router.replace({ name: 'mail-root-shortcut' })
    } catch (cause) {
      loginError.value = cause instanceof Error ? cause : new Error(String(cause))
      throw cause
    } finally {
      isLoggingIn.value = false
    }
  }

  // The platform logout: it runs every logout cleanup, such as dropping this browser's push
  // token, and then reloads the page, which clears Mail's state.
  const logout = session.logout

  const branding = useQuery(api.mail.public.branding)

  // Called when a request fails with an auth/permission error: sign the user out (clear state,
  // one toast, redirect to login) when their session is actually gone. No-op when still logged
  // in (a genuine PermissionError that should surface) or when there was never a session in
  // this tab (a failed login attempt — let the form show "wrong password"). Frappe resets the
  // user_id cookie to Guest on a dead session, so the cookie is the discriminator. Idempotent:
  // once the session user is cleared, concurrent calls return early, so the toast/redirect fire once.
  const handleSessionExpired = (): void => {
    if (getSessionUser()) return
    if (!session.user) return

    platformSession.expire()
    session.user = null
    reset()
    raiseToast(__('You have been signed out. Please sign in again.'), 'error')
    if (router.currentRoute.value.name !== 'mail-login') router.replace({ name: 'mail-login' })
  }

  return {
    isLoggedIn: computed(() => session.isLoggedIn),
    login,
    isLoggingIn,
    loginError,
    logout,
    branding,
    handleSessionExpired,
  }
})
