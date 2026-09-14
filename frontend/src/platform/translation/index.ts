import type { App, Plugin } from 'vue'

import { transport, type Operation } from '@/platform/transport'

export type Replacement = Array<string | number> | Record<string, string | number>
export type TranslationCatalog = Record<string, string>
export type TranslationFunction = (
  message: string,
  replace?: Replacement,
  context?: string | null,
) => string

const translationOperation: Operation<Record<string, never>, TranslationCatalog> = {
  id: 'frappe.translate.get_boot_translations',
  owner: 'suite',
  method: 'GET',
  path: '/api/v2/method/frappe.translate.get_boot_translations',
}

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
    .request(translationOperation, {})
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

function format(message: string, replace?: Replacement): string {
  if (!replace || typeof replace !== 'object') return message
  return message.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = Array.isArray(replace) ? replace[Number(key)] : replace[key]
    return value === undefined ? match : String(value)
  })
}

export default translationPlugin
