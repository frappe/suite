// shared by the service worker, so nothing here may import app modules
export const MEDIA_CACHE_NAME = 'slides-media'
export const API_CACHE_NAME = 'slides-api'
export const ASSETS_CACHE_NAME = 'slides-assets'
export const SHELL_CACHE_NAME = 'slides-shell'
export const PINNED_CACHE_NAME = 'slides-pinned'
export const VISITED_CACHE_NAME = 'slides-visited'

export const PIN_HEADER = 'x-slides-pin'

export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError'
}

// every visited presentation opens this one shell, see stores/visitedCopies.js
export const VISITED_SHELL_KEY = '/slides-visited-shell'

// localStorage: one offline copy record per presentation
export const RECORD_PREFIX = 'slides-offline-copy:'

// indexedDB: the unsynced drafts, one record per presentation. Each user has a
// database of their own; the bare name is the one every user once shared
export const DRAFTS_DB_NAME = 'slides-db'
export function draftsDbName(user) {
  return `${DRAFTS_DB_NAME}:${user}`
}

// everything but the bundle, which is public and identical for every user
export const USER_CACHE_NAMES = [
  SHELL_CACHE_NAME,
  API_CACHE_NAME,
  MEDIA_CACHE_NAME,
  PINNED_CACHE_NAME,
  VISITED_CACHE_NAME,
]
