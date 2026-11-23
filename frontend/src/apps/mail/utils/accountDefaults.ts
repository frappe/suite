/** Choose only provider-supported browser preferences; the server fills missing values. */
export function accountDefaults(options?: {
  locales: { value: string }[]
  time_zones: { value: string }[]
}) {
  const locales = options?.locales ?? []
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages
  const locale = languages
    .map(
      (language) =>
        locales.find((option) => option.value.toLowerCase() === language.toLowerCase())?.value,
    )
    .find(Boolean)
  let zone: string | undefined
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // A missing Intl time zone leaves the site default to the server.
  }
  return {
    locale: locale ?? null,
    time_zone: options?.time_zones.find((option) => option.value === zone)?.value ?? null,
  }
}
