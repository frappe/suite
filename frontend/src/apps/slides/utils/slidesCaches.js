// shared by the service worker, so nothing here may import app modules
export const MEDIA_CACHE_NAME = 'slides-media'
export const API_CACHE_NAME = 'slides-api'
export const ASSETS_CACHE_NAME = 'slides-assets'
export const SHELL_CACHE_NAME = 'slides-shell'
export const PINNED_CACHE_NAME = 'slides-pinned'

export const PIN_HEADER = 'x-slides-pin'

// localStorage: one offline copy record per presentation
export const RECORD_PREFIX = 'slides-offline-copy:'

// indexedDB: the unsynced drafts, one record per presentation
export const DRAFTS_DB_NAME = 'slides-db'

// everything but the bundle, which is public and identical for every user
export const USER_CACHE_NAMES = [
	SHELL_CACHE_NAME,
	API_CACHE_NAME,
	MEDIA_CACHE_NAME,
	PINNED_CACHE_NAME,
]
