import { computed, ref } from 'vue'
import emitter from '@/apps/drive/emitter'
import router from '@/apps/drive/router'
import { rootInfo } from '@/apps/drive/resources/files'
import { shareView } from '@/apps/drive/data/prefs'
import { useSessionStore } from '@/boot/session'

type DriveBreadcrumb = Record<string, unknown>

/** Published by the page that owns the entity; crumbs derive from it + route. */
const crumbEntity = ref<Record<string, unknown> | null>(null)

const ENTITY_ROUTES = ['drive-Folder', 'drive-File', 'drive-Document']

export function setCrumbEntity(entity: Record<string, unknown> | null) {
  crumbEntity.value = entity
}

export function clearCrumbEntity(entityName?: string) {
  if (!entityName || crumbEntity.value?.name === entityName) {
    crumbEntity.value = null
  }
}

function rootCrumb(routeName: string, path: string): DriveBreadcrumb {
  return {
    label: __(routeName.replace(/^drive-/, '')),
    name: routeName,
    route: path,
  }
}

function attachmentCrumbs(
  routeName: string,
  doctype?: string,
  docname?: string,
): DriveBreadcrumb[] {
  // Its own route, not the current path: this crumb is the way back out of a
  // doctype or document, so it can't point at the page you're already on.
  const crumbs = [
    { ...rootCrumb(routeName, ''), route: { name: routeName } },
  ]
  if (doctype) {
    crumbs.push({
      label: doctype,
      name: doctype,
      route: { name: routeName, params: { doctype } },
    })
    if (docname) {
      crumbs.push({
        label: docname,
        name: docname,
        route: { name: routeName, params: { doctype, docname } },
      })
    }
  }
  return crumbs
}

export const pageBreadcrumbs = computed<DriveBreadcrumb[]>(() => {
  const route = router.currentRoute.value
  const routeName = typeof route?.name === 'string' ? route.name : ''
  if (!routeName.startsWith('drive-')) return []

  if (routeName === 'drive-Attachments')
    return attachmentCrumbs(
      routeName,
      route.params.doctype as string,
      route.params.docname as string,
    )
  if (ENTITY_ROUTES.includes(routeName)) {
    const entityName = String(route.params.entityName || '')
    const entity = crumbEntity.value
    // The trail is anchored on the caller's home and the Site folder, so
    // rendering before rootInfo lands yields a wrong trail, not a late one.
    // Guests never get rootInfo, so they render the plain trail instead.
    const anchored = rootInfo.data || !useSessionStore().isLoggedIn
    return entity && entity.name === entityName && anchored
      ? buildBreadCrumbs(entity)
      : [{ loading: true, name: entityName }]
  }
  return [rootCrumb(routeName, route.path)]
})

export function getRootSection(): DriveBreadcrumb {
  return pageBreadcrumbs.value[0] || {}
}

export function isHomeContext() {
  return getRootSection().name === 'drive-Home'
}

/** Build navbar crumbs from entity API payload — pure, no side effects. */
function buildBreadCrumbs(entity: Record<string, unknown>) {
  let breadcrumbs = [
    ...((entity.breadcrumbs as Array<Record<string, unknown>>) || []),
  ]
  if (!breadcrumbs.length)
    return [{ label: entity.file_name, name: entity.name, route: null }]

  let res: DriveBreadcrumb[] = []
  if (entity.attached_to_doctype) {
    res = [
      {
        label: __('Attachments'),
        name: 'drive-Attachments',
        route: { name: 'drive-Attachments' },
      },
      {
        label: entity.attached_to_doctype,
        name: entity.attached_to_doctype,
        route: {
          name: 'drive-Attachments',
          params: { doctype: entity.attached_to_doctype },
        },
      },
    ]
    if (entity.attached_to_name) {
      res.push({
        label: entity.attached_to_name,
        name: entity.attached_to_name,
        route: {
          name: 'drive-Attachments',
          params: {
            doctype: entity.attached_to_doctype,
            docname: entity.attached_to_name,
          },
        },
      })
    }
    breadcrumbs = breadcrumbs.slice(-1)
  } else {
    // The path runs through the caller's own folder (→ "Home"), the shared
    // site folder (→ "Everyone"), or is a shared suffix (→ Home's "With you").
    const homeIdx = breadcrumbs.findIndex((b) => b.name === rootInfo.data?.home)
    const siteIdx = breadcrumbs.findIndex((b) => b.name === rootInfo.data?.root)
    if (homeIdx > -1) {
      res = [{ label: __('Home'), name: 'drive-Home', route: { name: 'drive-Home' } }]
      breadcrumbs = breadcrumbs.slice(homeIdx + 1)
    } else if (siteIdx > -1) {
      res = [
        {
          label: __('Everyone'),
          name: breadcrumbs[siteIdx].name,
          route: {
            name: 'drive-Folder',
            params: { entityName: breadcrumbs[siteIdx].name },
          },
        },
      ]
      breadcrumbs = breadcrumbs.slice(siteIdx + 1)
    } else if (useSessionStore().isLoggedIn) {
      res = [
        {
          label: __('Shared with me'),
          name: 'drive-Home',
          route: { name: 'drive-Home' },
          // Home opens on your own files; this crumb means the other tab.
          onClick: () => (shareView.value = true),
        },
      ]
    }
  }

  breadcrumbs.forEach((folder, idx) => {
    const final = idx === breadcrumbs.length - 1
    res.push({
      label: folder.file_name,
      name: folder.name,
      onClick: final ? () => entity.write && emitter.emit('rename') : undefined,
      route: final
        ? null
        : { name: 'drive-Folder', params: { entityName: folder.name } },
    })
  })
  return res
}
