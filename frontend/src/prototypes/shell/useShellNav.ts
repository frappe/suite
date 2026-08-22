// PROTOTYPE — remove. Route helpers for the throwaway shell prototype:
// area/sub come from the route params.
import { computed } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import type { AreaId, DocApp, DocRef } from './fixtures'

const AREAS: AreaId[] = ['home', 'files', 'mail', 'calendar', 'doc']

export function useShellNav() {
  const route = useRoute()
  const router = useRouter()

  const area = computed<AreaId>(() => {
    const raw = route.params.area as AreaId
    return AREAS.includes(raw) ? raw : 'home'
  })

  // `:sub*` hands back an array. Every area except Files reads one segment.
  const segments = computed(() => {
    const raw = route.params.sub
    if (Array.isArray(raw)) return raw.filter(Boolean)
    return raw ? [String(raw)] : []
  })

  const sub = computed(() => segments.value[0] ?? '')

  /** Folder ids under `files/folder/…`; empty means the tree root. */
  const folderPath = computed(() =>
    area.value === 'files' && segments.value[0] === 'folder'
      ? segments.value.slice(1)
      : [],
  )

  // The saved view the sidebar highlights. Descending into the tree is a
  // different mode, so it deliberately reports none — the sidebar would
  // otherwise claim "All files" while the list shows one folder's contents.
  const folder = computed(() => {
    if (area.value !== 'files' || folderPath.value.length) return ''
    return sub.value || 'all'
  })

  function areaTo(target: AreaId, targetSub?: string): RouteLocationRaw {
    return {
      name: 'prototype-shell',
      params: { area: target, sub: targetSub ? [targetSub] : [] },
    }
  }

  /** `doc/<app>/<id>` — the app and document the doc area should mount. */
  const openDoc = computed<DocRef | null>(() => {
    if (area.value !== 'doc') return null
    const [app, id] = segments.value
    if (!app || !id) return null
    return { app: app as DocApp, id }
  })

  /** Route that opens a real document inside the shell. */
  function docTo(ref: DocRef): RouteLocationRaw {
    return {
      name: 'prototype-shell',
      params: { area: 'doc', sub: [ref.app, ref.id] },
    }
  }

  /** Route for a folder in the Files tree; an empty path is the tree root. */
  function folderTo(path: string[]): RouteLocationRaw {
    return {
      name: 'prototype-shell',
      params: { area: 'files', sub: path.length ? ['folder', ...path] : [] },
    }
  }

  function go(target: AreaId, targetSub?: string) {
    router.push(areaTo(target, targetSub))
  }

  return { area, sub, folder, folderPath, openDoc, areaTo, docTo, folderTo, go }
}
