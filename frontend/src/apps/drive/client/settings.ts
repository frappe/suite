import type { Operation } from '@/platform/transport'
import { mutation, query } from '@/platform/server-state'

import {
  api,
  type RootUsageInput,
  type RootUsageOutput,
  type SettingsPatchInput,
  type SettingsPatchOutput,
  type SiteSettingsPatchInput,
  type SiteSettingsPatchOutput,
  type WebdavGetInput,
  type WebdavGetOutput,
} from './generated'
import { driveOperation } from './operation'

const rootUsageOperation = driveOperation<RootUsageInput, RootUsageOutput>(api.root_usage)
const webdavOperation = driveOperation<WebdavGetInput, WebdavGetOutput>(api.webdav_get)
const settingsPatchOperation = driveOperation<SettingsPatchInput, SettingsPatchOutput>(api.settings_patch)
const siteSettingsPatchOperation = driveOperation<SiteSettingsPatchInput, SiteSettingsPatchOutput>(
  api.site_settings_patch,
)

// A Suite method, not a Drive route: it mints the caller's API key and
// secret. The secret shows once and is never read back.
const generateUserKeysOperation: Operation<{ user: string }, { api_key: string; api_secret: string }> = {
  id: 'suite.generate_user_keys',
  owner: 'suite',
  method: 'POST',
  path: '/api/v2/method/suite.utils.user.generate_user_keys',
}

/** One file in a root's largest-files list. */
export type LargestFile = NonNullable<RootUsageOutput['largest']>[number]

/**
 * Bytes used by one root, its quota, and what the bytes are made of. A quota
 * of 0 is unlimited.
 */
export function rootStorage(root: string) {
  return query(rootUsageOperation, { root, expand: 'breakdown' }, { staleTime: 0 })
}

/** How to mount Drive over WebDAV, or `{}` when there is nothing to show. */
export function webdav() {
  return query(webdavOperation, {}, { staleTime: 0 })
}

const WEBDAV_ANSWER = api.webdav_get.id

export const saveUserSettings = mutation(settingsPatchOperation, { invalidates: [WEBDAV_ANSWER] })

export const saveSiteSettings = mutation(siteSettingsPatchOperation, { invalidates: [WEBDAV_ANSWER] })

export const generateUserKeys = mutation(generateUserKeysOperation, { invalidates: [WEBDAV_ANSWER] })
