import { ref } from 'vue'
import emitter from '@/apps/drive/emitter'
import { getTeams, getPublicTeams } from '@/apps/drive/resources/files'
import { useSessionStore } from '@/boot/session'

export type DriveBreadcrumb = Record<string, unknown>

/** Current page breadcrumb trail — in-memory only; derived from route + entity API. */
export const pageBreadcrumbs = ref<DriveBreadcrumb[]>([])

export type BreadcrumbUpdate =
  | DriveBreadcrumb[]
  | { loading: true; name: string }

export function setPageBreadcrumbs(items: BreadcrumbUpdate) {
  if (!Array.isArray(items)) {
    const crumbs = [...pageBreadcrumbs.value]
    if (crumbs.length > 1) crumbs.splice(1)
    crumbs.push({ loading: true, name: items.name })
    pageBreadcrumbs.value = crumbs
    return
  }
  pageBreadcrumbs.value = items
}

export function getRootSection(): DriveBreadcrumb {
  return pageBreadcrumbs.value[0] || {}
}

export function isHomeContext() {
  return getRootSection().name === 'drive-Home'
}

export function appendBreadcrumb(item: DriveBreadcrumb) {
  pageBreadcrumbs.value = [...pageBreadcrumbs.value, item]
}

export function updateLastBreadcrumbLabel(label: string, entityName?: string) {
  const last = pageBreadcrumbs.value[pageBreadcrumbs.value.length - 1]
  if (last && (!entityName || last.name === entityName)) {
    last.label = label
  }
}

/** Build navbar crumbs from entity API payload — pure, no side effects. */
export function buildBreadCrumbs(entity: Record<string, unknown>) {
  let breadcrumbs = entity.breadcrumbs as Array<Record<string, unknown>>
  const in_home = entity.in_home
  const team =
    getTeams.data?.[breadcrumbs[0].team as string] ||
    getPublicTeams.data?.[breadcrumbs[0].team as string]

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
  } else if (team || in_home) {
    res = [
      {
        label: in_home ? __('Home') : team.title,
        name: in_home ? 'drive-Home' : team.name,
        route: in_home
          ? { name: 'drive-Home' }
          : { name: 'drive-Team', params: { team: team.name } },
      },
    ]
  } else if (entity.folder === 'Home/Attachments' || entity.folder === 'Home') {
    res = [
      {
        label: __('Shared'),
        name: 'drive-Shared',
        route: '/drive/shared',
      },
    ]
  } else if (useSessionStore().isLoggedIn) {
    res = [
      {
        label: __('Shared'),
        name: 'drive-Shared',
        route: '/drive?shared=1',
      },
    ]
  }

  if (!breadcrumbs[0].folder) breadcrumbs.splice(0, 1)
  const popBreadcrumbs = (item: DriveBreadcrumb) => () =>
    res.splice(res.findIndex((k) => k.name === item.name) + 1)

  breadcrumbs.forEach((folder, idx) => {
    const final = idx === breadcrumbs.length - 1
    res.push({
      label: folder.file_name,
      name: folder.name,
      onClick: final
        ? () => entity.write && emitter.emit('rename')
        : popBreadcrumbs(folder),
      route: final
        ? null
        : { name: 'drive-Folder', params: { entityName: folder.name } },
    })
  })
  return res
}

export function applyBreadCrumbs(entity: Record<string, unknown>) {
  setPageBreadcrumbs(buildBreadCrumbs(entity))
}
