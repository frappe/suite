import type { RouteLocationNormalized } from 'vue-router'

export let previousRoute: RouteLocationNormalized | null = null
export let editorAccess = 'none'

export function setPreviousRoute(route: RouteLocationNormalized | null) {
  previousRoute = route
}

export function setEditorAccess(access: string) {
  editorAccess = access
}
