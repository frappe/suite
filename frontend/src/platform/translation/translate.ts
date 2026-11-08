import { format, type Replacement } from './format'

export type TranslationCatalog = Record<string, string>

let catalog: TranslationCatalog =
  typeof window === 'undefined' ? {} : (window.translatedMessages ?? {})

export function setCatalog(next: TranslationCatalog) {
  catalog = next
}

/**
 * Translates with whichever catalog has loaded. Code in the server's Node bundles imports this
 * file, not the package root: the root fetches the catalog as it loads.
 */
export function translate(
  message: string,
  replace?: Replacement,
  context: string | null = null,
): string {
  if (!message || typeof message !== 'string') return message
  const contextual = context ? catalog[`${message}:${context}`] : undefined
  return format(contextual || catalog[message] || message, replace)
}
