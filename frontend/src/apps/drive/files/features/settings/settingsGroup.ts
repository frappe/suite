import { api, useQuery } from '@/api'
import { translate as __ } from '@/platform/translation'

import { locationLabel } from '../../internal/locations'

// Held for the session: the group condition and the External access body
// read the same answer.
const webdavAnswer = useQuery(api.drive.webdav.get, {})

const drive = {
  label: () => __('Drive'),
  area: 'files',
  tabs: [
    {
      id: 'drive.statistics',
      // The id stays, so saved links to the tab still open it.
      label: () => __('Storage'),
      icon: 'lucide-chart-pie',
      description: () => __('Pictures and videos inside a document count towards that document.'),
      body: () => import('./StatisticsSettings.vue'),
    },
    {
      id: 'drive.external-access',
      label: () => __('External access'),
      icon: 'lucide-hard-drive',
      description: () =>
        __('Open your Drive files in Finder, Windows Explorer and other file apps.'),
      keywords: () => __('WebDAV, API key'),
      // The route answers `{}` when WebDAV is off and the caller is no admin.
      condition: () => Object.keys(webdavAnswer.data ?? {}).length > 0,
      body: () => import('./ExternalAccessSettings.vue'),
      sections: [
        {
          id: 'connect',
          label: () => __('Connect file apps'),
          description: () =>
            __('Uses WebDAV. Shows My files, not {0}.', [locationLabel('organization')]),
        },
      ],
    },
  ],
} as const

/** Reads the WebDAV answer again, then resolves the Drive settings group. */
export async function driveSettings() {
  await webdavAnswer.refetch().catch(() => undefined)
  return drive
}
