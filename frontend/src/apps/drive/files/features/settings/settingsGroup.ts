import { shallowRef } from 'vue'

import { api, useQuery } from '@/api'
import { translate as __ } from '@/platform/translation'

import { locationLabel } from '../../internal/locations'

// Held for the session: the group condition and the External access body
// read the same answer. Made the first time Settings opens, not as the app
// starts, since this list is part of the app.
const webdavAnswer = shallowRef<ReturnType<typeof askWebdav>>()
const askWebdav = () => useQuery(api.drive.webdav.get, {})

export const driveSettings = {
  label: () => __('Drive'),
  area: 'files',
  tabs: [
    {
      id: 'drive.external-access',
      label: () => __('External access'),
      icon: 'lucide-hard-drive',
      description: () =>
        __('Open your Drive files in Finder, Windows Explorer and other file apps.'),
      keywords: () => __('WebDAV, API key'),
      // The route answers `{}` when WebDAV is off and the caller is no admin.
      condition: () => Object.keys(webdavAnswer.value?.data ?? {}).length > 0,
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
  /** Asks for the WebDAV answer, or asks again on a later open. */
  refresh: async () => {
    if (webdavAnswer.value) await webdavAnswer.value.refetch()
    else webdavAnswer.value = askWebdav()
  },
} as const
