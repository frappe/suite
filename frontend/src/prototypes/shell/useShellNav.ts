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

  // The Folders list also shows on Home, where nothing is open yet — so an
  // active folder only exists inside the Files area.
  const folder = computed(() => (area.value === 'files' ? sub.value || 'all' : ''))

  function areaTo(target: AreaId, targetSub?: string): RouteLocationRaw {
    return {
      name: 'prototype-shell',
      params: { area: target, sub: targetSub ?? '' },
    }
  }

  function go(target: AreaId, targetSub?: string) {
    router.push(areaTo(target, targetSub))
  }

  return { area, sub, folder, areaTo, go }
}
