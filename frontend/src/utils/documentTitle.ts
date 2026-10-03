import {
	calendarLogo,
	driveLogo,
	mailLogo,
	meetLogo,
	sheetsLogo,
	slidesLogo,
	writerLogo,
} from '@/platform/brand'

const APP_LOGOS: Record<string, string> = {
  Calendar: calendarLogo,
  Drive: driveLogo,
  Mail: mailLogo,
  Meet: meetLogo,
  Sheets: sheetsLogo,
  Slides: slidesLogo,
  Writer: writerLogo,
}

export function appDocumentTitle(pageTitle: string | undefined, appName: string) {
  const title = pageTitle?.trim()
  if (!title || title === appName || title === `Frappe ${appName}`) return appName
  if (title.endsWith(` | ${appName}`)) return title
  return `${title} | ${appName}`
}

export function appPageMeta(pageTitle: string | undefined, appName: string) {
  return {
    title: appDocumentTitle(pageTitle, appName),
    icon: APP_LOGOS[appName],
  }
}
