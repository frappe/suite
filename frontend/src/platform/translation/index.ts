import type { App, Plugin } from 'vue'

import { transport } from '@/platform/transport'
import { api } from '@/platform/transport/api'

import type { Replacement } from './format'
import { setCatalog, translate } from './translate'

export type { Replacement } from './format'
export { translate } from './translate'
export type { TranslationCatalog } from './translate'
export type TranslationFunction = (
  message: string,
  replace?: Replacement,
  context?: string | null,
) => string

let loadPromise: Promise<void> | null = null

export function loadTranslations(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = transport
    .request(api.translations.get, {})
    .then((messages) => {
      setCatalog(messages ?? {})
      if (typeof window !== 'undefined') window.translatedMessages = messages ?? {}
    })
    .catch(() => {
      // Rendering source strings is the safe fallback when the catalog route is unavailable.
    })
  return loadPromise
}

export const ready = loadTranslations()

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Template translation helper that `translationPlugin` installs. */
    __: TranslationFunction
  }
}

export const translationPlugin: Plugin = {
  install(app: App) {
    app.config.globalProperties.__ = translate
    if (typeof window !== 'undefined') window.__ = translate
  },
}

export function installTranslation(app: App): Promise<void> {
  app.use(translationPlugin)
  return ready
}

export default translationPlugin
