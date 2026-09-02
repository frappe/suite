import type { RouteLocationNormalized, RouteLocationNormalizedLoaded } from 'vue-router'
import { createResource } from 'frappe-ui'

import { getSessionUser, useSessionStore } from '@/boot/session'
import { removeOfflineCopy } from '@/apps/slides/stores/offlineCopy'
import { claimSlidesCachesFor } from '@/apps/slides/utils/serviceWorker'
import { editorAccess, setEditorAccess, setPreviousRoute } from './routerState'

const getEditorAccess = async (presentationId: string) => {
  try {
    return await createResource({
      url: 'suite.slides.doctype.presentation.presentation.get_editor_access',
      method: 'GET',
    }).submit({
      doctype: 'Presentation',
      presentation_id: presentationId,
    })
  } catch (error) {
    console.error('Failed to fetch presentation access level:', error)
    return false
  }
}

const SLIDES_GUARDED = new Set(['slides-slideshow', 'slides-editor', 'slides-home'])

export const beforeEach = async (
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded,
) => {
  setPreviousRoute(from)

  const user = getSessionUser()
  if (user) await claimSlidesCachesFor(user).catch(() => {})

  if (typeof to.name !== 'string' || !SLIDES_GUARDED.has(to.name)) return

  if (to.name === 'slides-slideshow' && !from.name) {
    return { name: 'slides-editor', params: to.params, query: to.query }
  }
  if (to.name === 'slides-slideshow') return

  if (to.name === 'slides-editor') {
    if (from.name !== to.name || from.params.presentationId !== to.params.presentationId) {
      setEditorAccess((await getEditorAccess(to.params.presentationId as string)) as string)
    }
    if (['edit', 'view'].includes(editorAccess)) return
    if (!useSessionStore().isLoggedIn) {
      window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
      return false
    }
    if (editorAccess === 'none') {
      removeOfflineCopy(to.params.presentationId as string).catch(() => {})
    }
    return { name: 'slides-not-permitted' }
  }
}
