// PROTOTYPE — remove. Route helpers for the throwaway shell prototype:
// area/sub come from the route params.
import { computed } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import type { AreaId } from './fixtures'

const AREAS: AreaId[] = ['home', 'files', 'mail', 'calendar']

export function useShellNav() {
  const route = useRoute()
  const router = useRouter()

  const area = computed<AreaId>(() => {
    const raw = route.params.area as AreaId
    return AREAS.includes(raw) ? raw : 'home'
  })

  const sub = computed(() => (route.params.sub as string) || '')

  function areaTo(target: AreaId, targetSub?: string): RouteLocationRaw {
    return {
      name: 'prototype-shell',
      params: { area: target, sub: targetSub ?? '' },
    }
  }

  function go(target: AreaId, targetSub?: string) {
    router.push(areaTo(target, targetSub))
  }

  return { area, sub, areaTo, go }
}
