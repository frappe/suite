import calendarLogo from '@/assets/app-logos/calendar.svg'
import driveLogo from '@/assets/app-logos/drive.svg'
import mailLogo from '@/assets/app-logos/mail.svg'
import meetLogo from '@/assets/app-logos/meet.png'
import sheetsLogo from '@/assets/app-logos/sheets.svg'
import slidesLogo from '@/assets/app-logos/slides.svg'
import writerLogo from '@/assets/app-logos/writer.png'

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
