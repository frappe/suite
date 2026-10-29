/** Redact URL capabilities in normal telemetry JSON, including nested SDK context. */
export function redactTelemetry(value: unknown): void {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string') Reflect.set(value, key, redactUrlCredentials(field))
    else redactTelemetry(field)
  }
}

function redactUrlCredentials(value: string): string {
  return value
    .replace(/\/(?:drive\/)?l\/[^/?#\s"'<>]+/gi, '/l/[Filtered]')
    .replace(/([?&#])([^=&#?\s"'<>]+)=([^&#\s"'<>]*)/g, (match, separator, key) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(key).toLowerCase()
      } catch {
        // Malformed keys cannot be classified safely; discard their value.
        return `${separator}[Filtered]=[Filtered]`
      }
      return /^(link|token|s|signature|access_token|auth|authorization|password|credential|x-amz-.+|x-goog-.+)$/.test(
        decoded,
      )
        ? `${separator}${key}=[Filtered]`
        : match
    })
}
