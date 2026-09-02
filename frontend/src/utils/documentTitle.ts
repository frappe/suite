import { SUITE_APPS } from '@/apps/registry'

export function appDocumentTitle(pageTitle: string | undefined, appName: string) {
  const title = pageTitle?.trim()
  if (!title || title === appName || title === `Frappe ${appName}`) return appName
  if (title.endsWith(` | ${appName}`)) return title
  return `${title} | ${appName}`
}

export function appPageMeta(pageTitle: string | undefined, appName: string) {
  return {
    title: appDocumentTitle(pageTitle, appName),
    icon: SUITE_APPS.find((app) => app.name === appName)?.logo,
  }
}
