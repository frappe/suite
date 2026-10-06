export function appDocumentTitle(pageTitle: string | undefined, appName: string) {
  const title = pageTitle?.trim()
  if (!title || title === appName || title === `Frappe ${appName}`) return appName
  if (title.endsWith(` | ${appName}`)) return title
  return `${title} | ${appName}`
}

/**
 * The title an app page shows. No `icon`: the Suite logo is the one favicon,
 * and frappe-ui's `usePageMeta` restores it when a page sets none.
 */
export function appPageMeta(pageTitle: string | undefined, appName: string) {
  return { title: appDocumentTitle(pageTitle, appName) }
}
