import type { RouteLocationNormalized, RouteRecordRaw, Router } from 'vue-router'

import { createResource } from 'frappe-ui'

import { router, setEditorAccess, setPreviousRoute } from '@/apps/slides/router'
import SlidesShell from '@/apps/slides/SlidesShell.vue'
import { getSessionUser, useSessionStore } from '@/boot/session'
import { claimSlidesCachesFor, postToServiceWorker } from '@/apps/slides/utils/serviceWorker'
import { removeOfflineCopy } from '@/apps/slides/stores/offlineCopy'

/**
 * Slides route module — mounted by the suite router under the '/slides' prefix.
 *
 * Paths are RELATIVE to '/slides' (no leading slash; '' is the app index).
 * Route names are namespaced `slides-*` to avoid collisions in the single
 * suite router. Views are lazy so slides' heavy editor deps stay code-split.
 */

let currentEditorAccess = 'none'

const withPresentationProps = (route: RouteLocationNormalized) => {
  const slide = parseInt(route.query.slide as string)
  const activeSlideId = Number.isFinite(slide) ? slide : 1

  return {
    presentationId: route.params.presentationId,
    activeSlideId,
    editorAccess: currentEditorAccess,
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: SlidesShell,
    // before the route components resolve, so the whole graph loads as slides
    beforeEnter: () => postToServiceWorker('slides-entered'),
    children: [
      {
        path: '',
        name: 'slides-home',
        component: () => import('@/apps/slides/pages/Home.vue'),
      },
      {
        path: 'presentation/new',
        name: 'slides-editor-new',
        component: () => import('@/apps/slides/pages/PresentationEditor.vue'),
        props: withPresentationProps,
      },
      {
        path: 'presentation/:presentationId/:slug?',
        name: 'slides-editor',
        component: () => import('@/apps/slides/pages/PresentationEditor.vue'),
        props: withPresentationProps,
        meta: { allowGuest: true },
      },
      {
        path: 'presentation/view/:presentationId/:slug?',
        redirect: (route: RouteLocationNormalized) => ({
          name: 'slides-editor',
          params: route.params,
          query: route.query,
        }),
      },
      {
        path: 'slideshow/:presentationId/:slug?',
        name: 'slides-slideshow',
        component: () => import('@/apps/slides/pages/Slideshow.vue'),
        props: withPresentationProps,
        meta: { allowGuest: true },
      },
      {
        path: 'not-permitted',
        name: 'slides-not-permitted',
        component: () => import('@/apps/slides/pages/errorPages/NotPermitted.vue'),
        meta: { allowGuest: true },
      },
    ],
  },
]

export default routes

/* -------------------------------------------------------------------------- */
/* Slides navigation guards: maintain `previousRoute` and gate the editor      */
/* route on the per-presentation access level. Installed once, the first time  */
/* this module is loaded (see bottom of file).                                 */
/* -------------------------------------------------------------------------- */

const getEditorAccess = async (presentationId: string) => {
  try {
    const response = await createResource({
      url: 'suite.slides.doctype.presentation.presentation.get_editor_access',
      method: 'GET',
    }).submit({
      doctype: 'Presentation',
      presentation_id: presentationId,
    })
    return response
  } catch (error) {
    console.error('Failed to fetch presentation access level:', error)
    return false
  }
}

const SLIDES_GUARDED = new Set(['slides-slideshow', 'slides-editor', 'slides-home'])

function installSlidesGuards(r: Router) {
  r.beforeEach(async (to, from, next) => {
    // Only act on slides routes; let the suite handle everything else.
    if (typeof to.name !== 'string' || !to.name.startsWith('slides-')) {
      return next()
    }

    setPreviousRoute(from)

    // before the first slides request of this visit is cached; a guest may be
    // this user with an expired session, so their copy stays
    const user = getSessionUser()
    if (user) await claimSlidesCachesFor(user).catch(() => {})

    if (!SLIDES_GUARDED.has(to.name)) {
      return next()
    }

    if (to.name === 'slides-slideshow' && !from.name) {
      return next({ name: 'slides-editor', params: to.params, query: to.query })
    } else if (to.name === 'slides-slideshow') {
      return next()
    } else if (to.name === 'slides-editor') {
      if (from.name !== to.name || from.params.presentationId !== to.params.presentationId) {
        currentEditorAccess = (await getEditorAccess(to.params.presentationId as string)) as string
        setEditorAccess(currentEditorAccess)
      }
      if (['edit', 'view'].includes(currentEditorAccess)) {
        return next()
      }
      if (!useSessionStore().isLoggedIn) {
        window.location.href = `/login?redirect-to=${encodeURIComponent(to.fullPath)}`
        return next(false)
      }
      // the server has withdrawn this presentation, so the offline copy goes with it
      if (currentEditorAccess === 'none') {
        removeOfflineCopy(to.params.presentationId as string).catch(() => {})
      }
      return next({ name: 'slides-not-permitted' })
    }
    return next()
  })
}

installSlidesGuards(router)
