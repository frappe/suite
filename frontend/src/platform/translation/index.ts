import type { App, Plugin } from 'vue'

import { transport } from '@/platform/transport'
import { api } from '@/platform/transport/api'

import { format } from './format'

export type Replacement = Array<string | number> | Record<string, string | number>
export type TranslationCatalog = Record<string, string>
export type TranslationFunction = (
  message: string,
  replace?: Replacement,
  context?: string | null,
) => string

let catalog: TranslationCatalog =
  typeof window === 'undefined' ? {} : (window.translatedMessages ?? {})
let loadPromise: Promise<void> | null = null

export function translate(
  message: string,
  replace?: Replacement,
  context: string | null = null,
): string {
  if (!message || typeof message !== 'string') return message
  const contextual = context ? catalog[`${message}:${context}`] : undefined
  return format(contextual || catalog[message] || message, replace)
}

export function loadTranslations(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = transport
    .request(api.translations.get, {})
    .then((messages) => {
      catalog = messages ?? {}
      if (typeof window !== 'undefined') window.translatedMessages = catalog
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
