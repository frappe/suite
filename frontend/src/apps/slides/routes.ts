import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'

import { editorAccess } from './routerState'

/**
 * Slides route module — mounted by the suite router under the '/slides' prefix.
 *
 * Paths are RELATIVE to '/slides' (no leading slash; '' is the app index).
 * Route names are namespaced `slides-*` to avoid collisions in the single
 * suite router. Views are lazy so slides' heavy editor deps stay code-split.
 */

const withPresentationProps = (route: RouteLocationNormalized) => {
  const slide = parseInt(route.query.slide as string)
  const activeSlideId = Number.isFinite(slide) ? slide : 1

  return {
    presentationId: route.params.presentationId,
    activeSlideId,
    editorAccess,
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/apps/slides/SlidesShell.vue'),
    // before the route components resolve, so the whole graph loads as slides
    beforeEnter: async () => {
      const { postToServiceWorker } = await import('@/apps/slides/utils/serviceWorker')
      return postToServiceWorker('slides-entered')
    },
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
