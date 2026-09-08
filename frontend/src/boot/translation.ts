import type { App } from 'vue'

/**
 * Shared frappe-style translation for the whole suite.
 *
 * The standalone apps (calendar, mail, …) each shipped their own translation
 * plugin that installed a global `__()` onto `app.config.globalProperties` (so
 * bare `__('text')` resolves inside templates) and onto `window.__` (so plain
 * `<script>`/util code can call it too). Since several ported apps use `__()`
 * the same way, the suite registers ONE generic translation plugin here instead
 * of per-app copies.
 *
 * This boot is intentionally endpoint-agnostic: `translate()` only looks up
 * `window.translatedMessages`. WHO populates that map is an app concern — an app
 * route module can fetch its own translations on load (e.g. mail/calendar's
 * `suite.mail.api.get_translations`) and assign the result to `window.translatedMessages`.
 * Until then `translate()` is an identity function, so untranslated UI still
 * renders the source string.
 */
export function translate(message: string, replace?: Array<string | number>): string {
  const messages = window.translatedMessages || {}
  let translated = messages[message] || message

  const hasPlaceholders = /{\d+}/.test(translated) && Array.isArray(replace)
  if (!hasPlaceholders) return translated

  return translated.replace(/{(\d+)}/g, (match: string, index: string) => {
    const value = replace![Number(index)]
    return value !== undefined ? String(value) : match
  })
}

export const translationPlugin = {
  install(app: App) {
    app.config.globalProperties.__ = translate
    window.__ = translate
  },
}
