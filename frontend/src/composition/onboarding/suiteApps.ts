import type { Component } from 'vue'

import { calendarArea } from '@/apps/calendar'
import { driveDocumentIcon, filesArea } from '@/apps/drive'
import { mailArea } from '@/apps/mail'
import { meetArea } from '@/apps/meet'

/** How onboarding draws an app: an area's duotone icon, or a file type's icon class. */
export type AppIcon = { component: Component } | { className: string }

export interface SuiteApp {
  id: string
  name: () => string
  icon: AppIcon
}

function fileIcon(contentDoctype: string): AppIcon {
  // Only the shape: onboarding draws every icon in gray.
  return { className: driveDocumentIcon(contentDoctype)[0] ?? '' }
}

/** The welcome step's row of apps, in the order the prototype introduces them. */
export const SUITE_APPS: readonly SuiteApp[] = [
  { id: 'drive', name: () => __('Drive'), icon: { component: filesArea.icon } },
  { id: 'writer', name: () => __('Writer'), icon: fileIcon('Writer Document') },
  { id: 'sheets', name: () => __('Sheets'), icon: fileIcon('Sheet') },
  { id: 'slides', name: () => __('Slides'), icon: fileIcon('Presentation') },
  { id: 'mail', name: () => __('Mail'), icon: { component: mailArea.icon } },
  { id: 'calendar', name: () => __('Calendar'), icon: { component: calendarArea.icon } },
  { id: 'meet', name: () => __('Meet'), icon: { component: meetArea.icon } },
]
