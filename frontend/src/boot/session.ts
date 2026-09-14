import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { getCookieSessionUser, useSession } from '@/platform/session'

const platformSession = useSession()

export const hasServerBoot =
  typeof window !== 'undefined' && typeof window.suite_is_onboarded !== 'undefined'

export const getSessionUser = getCookieSessionUser
export const fullName = computed(() => platformSession.user.value?.fullName ?? '')
export const imageURL = computed(() => platformSession.user.value?.avatar ?? '')
export const systemUser = computed(() => platformSession.capabilities.value.systemManager)
export const jmapUser = computed(() => platformSession.capabilities.value.jmap)

type LegacyAccount = Record<string, unknown> & {
  name?: string
  email?: string
  full_name?: string
  avatar?: string | null
  user_image?: string | null
  roles?: string[]
  is_jmap_configured?: boolean
}

function accountData(): LegacyAccount | null {
  const current = platformSession.user.value
  if (!current) return null
  return {
    ...current,
    name: current.id,
    email: current.email ?? current.id,
    full_name: current.fullName,
    avatar: current.avatar,
    user_image: current.avatar,
    roles: Array.isArray(current.roles)
      ? current.roles
      : platformSession.capabilities.value.systemManager
        ? ['System Manager']
        : [],
    is_jmap_configured: platformSession.capabilities.value.jmap,
  }
}

let userPromise: Promise<LegacyAccount | null> | null = null
export const userResource = reactive({
  data: accountData() as LegacyAccount | null,
  error: null as unknown,
  loading: platformSession.status.value === 'loading',
  fetched: platformSession.status.value !== 'loading',
  promise: null as Promise<LegacyAccount | null> | null,
  async fetch() {
    if (userPromise) return userPromise
    this.loading = true
    this.error = null
    userPromise = platformSession
      .refresh()
      .then(() => {
        this.data = accountData()
        this.fetched = true
        return this.data
      })
      .catch((error) => {
        this.error = error
        throw error
      })
      .finally(() => {
        this.loading = false
        userPromise = null
      })
    this.promise = userPromise
    return userPromise
  },
  reload() {
    return this.fetch()
  },
  reset() {
    this.data = null
    this.error = null
    this.loading = false
    this.fetched = false
    this.promise = null
  },
})

watch(
  [platformSession.user, platformSession.capabilities, platformSession.status],
  () => {
    userResource.data = accountData()
    userResource.loading = platformSession.status.value === 'loading'
    userResource.fetched = platformSession.status.value !== 'loading'
  },
  { deep: true },
)

if (platformSession.user.value) userResource.promise = userResource.fetch()

function legacyAction<Input>(run: (input: Input) => Promise<void>) {
  const action = reactive({
    data: null as null,
    error: null as unknown,
    loading: false,
    promise: null as Promise<void> | null,
    submit: null as unknown as (input: Input) => Promise<void>,
    fetch: null as unknown as (input: Input) => Promise<void>,
    reset: null as unknown as () => void,
  })
  const submit = async (input: Input) => {
    action.loading = true
    action.error = null
    const promise = run(input)
    action.promise = promise
    try {
      await promise
    } catch (error) {
      action.error = error
      throw error
    } finally {
      action.loading = false
    }
  }
  action.submit = submit
  action.fetch = submit
  action.reset = () => {
    action.error = null
    action.loading = false
    action.promise = null
  }
  return action
}

export const useSessionStore = defineStore('suite-session', () => {
  const user = ref<string | null>(platformSession.user.value?.id ?? getSessionUser())
  watch(platformSession.user, (next) => {
    user.value = next?.id ?? null
  })
  const isLoggedIn = computed(() => !!user.value)
  const login = legacyAction<{ usr?: string; pwd?: string; email?: string; password?: string }>(
    async (input) => {
      const email = input.usr ?? input.email ?? ''
      const password = input.pwd ?? input.password ?? ''
      await platformSession.login(email, password)
      user.value = platformSession.user.value?.id ?? email
    },
  )
  const logout = legacyAction<void>(async () => {
    await platformSession.logout()
    user.value = null
    if (typeof window !== 'undefined') window.location.reload()
  })
  return { user, isLoggedIn, login, logout }
})

export const session = reactive({
  user: computed(() => ({ sessionUser: platformSession.user.value?.id ?? null, ...userResource.data })),
  isLoggedIn: computed(() => !!platformSession.user.value),
})

export function useCurrentUser() {
  return {
    user: computed(() => platformSession.user.value?.id ?? null),
    isLoggedIn: computed(() => !!platformSession.user.value),
    fullName,
    imageURL,
    email: computed(() => platformSession.user.value?.email ?? platformSession.user.value?.id ?? ''),
    systemUser,
    isSystemManager: systemUser,
    jmapUser,
  }
}
