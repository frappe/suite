import { api, useQuery } from '@/api'
import { translate as __ } from '@/platform/translation'
import { isTweakOn } from '@/platform/tweaks'

// Held for the session: the group condition and the External access body
// read the same answer.
const webdavAnswer = useQuery(api.drive.webdav.get, {})

const drive = {
  label: () => __('Drive'),
  tabs: [
    {
      id: 'drive.statistics',
      // The id stays, so saved links to the tab still open it.
      label: () => (isTweakOn('t4-storage-tab') ? __('Storage') : __('Statistics')),
      icon: 'lucide-chart-pie',
      body: () => import('./StatisticsSettings.vue'),
    },
    {
      id: 'drive.external-access',
      label: () => __('External access'),
      icon: 'lucide-hard-drive',
      // The route answers `{}` when WebDAV is off and the caller is no admin.
      condition: () => Object.keys(webdavAnswer.data ?? {}).length > 0,
      body: () => import('./ExternalAccessSettings.vue'),
    },
  ],
} as const

/** Reads the WebDAV answer again, then resolves the Drive settings group. */
export async function driveSettings() {
  await webdavAnswer.refetch().catch(() => undefined)
  return drive
}
